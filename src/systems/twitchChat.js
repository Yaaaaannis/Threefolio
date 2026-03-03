// twitchChat.js — Anonymous read-only connection to a Twitch IRC channel.
// Uses the public wss://irc-ws.chat.twitch.tv endpoint — no OAuth needed for reading.

export class TwitchChat {
    /**
     * @param {string} channel  — channel name WITHOUT the #, e.g. "shroud"
     * @param {(username: string, message: string) => void} onMessage
     */
    constructor(channel, onMessage) {
        this._channel = channel.toLowerCase();
        this._onMessage = onMessage;
        this._ws = null;
        this._reconnectMs = 5000;
        this._connect();
    }

    _connect() {
        const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
        this._ws = ws;

        ws.onopen = () => {
            // Anonymous credentials (justinfanXXXXX always works on Twitch)
            ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
            ws.send('PASS SCHMOOPIIE\r\n');
            ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 89999)}\r\n`);
            ws.send(`JOIN #${this._channel}\r\n`);
            console.log(`[TwitchChat] Joined #${this._channel}`);
        };

        ws.onmessage = (event) => {
            const raw = event.data;
            // Keep-alive PING
            if (raw.startsWith('PING')) {
                ws.send('PONG :tmi.twitch.tv\r\n');
                return;
            }
            // Parse PRIVMSG: "@tags :user!user@... PRIVMSG #channel :message"
            const match = raw.match(/PRIVMSG\s+#\S+\s+:(.+)/);
            if (!match) return;
            const message = match[1].trim();

            // Extract display-name and color from IRCv3 tags
            const tagMatch = raw.match(/display-name=([^;]+)/);
            const username = tagMatch ? tagMatch[1] : raw.match(/:(\w+)!/)?.[1] ?? 'anon';
            const colorMatch = raw.match(/(?:^|;)color=(#[0-9A-Fa-f]{6})/);
            const color = colorMatch ? colorMatch[1] : '';  // '' = no color set

            this._onMessage(username, message, color);
        };

        ws.onclose = () => {
            console.log('[TwitchChat] Disconnected, reconnecting…');
            setTimeout(() => this._connect(), this._reconnectMs);
        };

        ws.onerror = (err) => {
            console.warn('[TwitchChat] WS error:', err);
            ws.close();
        };
    }

    dispose() {
        if (this._ws) {
            this._ws.onclose = null; // prevent reconnect loop
            this._ws.close();
            this._ws = null;
        }
    }
}
