const fs = require('fs');
const path = require('path');

const fileMap = {
    'main.js': '../core/main.js',
    'scene.js': '../core/scene.js',
    'stateManager.js': '../core/stateManager.js',
    'player.js': '../entities/player.js',
    'chess.js': '../entities/chess.js',
    'grass.js': '../environment/grass.js',
    'room.js': '../environment/room.js',
    'cubeWall.js': '../environment/cubeWall.js',
    'spawnerZone.js': '../environment/spawnerZone.js',
    'chessZone.js': '../environment/chessZone.js',
    'particleSystem.js': '../systems/particleSystem.js',
    'echoSystem.js': '../systems/echoSystem.js',
    'mobileControls.js': '../ui/mobileControls.js',
};

const allFiles = [
    'core/main.js', 'core/scene.js', 'core/stateManager.js',
    'entities/player.js', 'entities/chess.js',
    'environment/grass.js', 'environment/room.js', 'environment/cubeWall.js', 'environment/spawnerZone.js', 'environment/chessZone.js',
    'systems/particleSystem.js', 'systems/echoSystem.js',
    'ui/mobileControls.js'
];

allFiles.forEach(file => {
    const filePath = path.join('src', file);
    if (!fs.existsSync(filePath)) {
        console.warn('Missing file:', filePath);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace occurrences: from './filename.js' -> from '../folder/filename.js'
    Object.keys(fileMap).forEach(key => {
        // e.g. from './scene.js'
        const searchStr = `from './${key}'`;
        const replaceStr = `from '${fileMap[key]}'`;
        
        // This is a simple string replacement (use split/join for replaceAll)
        content = content.split(searchStr).join(replaceStr);
    });

    fs.writeFileSync(filePath, content);
});

console.log('Imports successfully rewritten.');
