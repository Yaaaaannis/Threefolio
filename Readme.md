Parfait.
On va faire ça **propre, structuré, concret**, comme une vraie fiche de production.

Projet pensé pour :

* Three.js natif
* Rapier 
* Sans framework
* Expérience narrative 3–4 minutes
* Niveau portfolio agence créative

---

# 🎮 FICHE PROJET

## Nom de travail

**WHAT REMAINS**

---

# 1️⃣ INTENTION

Une expérience interactive minimaliste.

Le joueur est enfermé dans une pièce vide.
Chaque mouvement laisse un écho.
Ces échos deviennent physiques et construisent l’espace.

La pièce réagit au comportement du joueur :

* Actif → elle s’ouvre
* Passif → elle se referme

Le monde est une conséquence.

---

# 2️⃣ GAME DESIGN SIMPLIFIÉ

## Durée cible

3 à 4 minutes

## Contrôles

* Fleche directionnelles 
* Mouse look
*  saut obligatoire pour joueur sur les plateformes

---

## Boucle principale

1. Le joueur se déplace il faut que ca soit un jeu en vue de dessus pas un fps, je veux une vue en biais du haut de la salle qui sera une salle avec le toit coupé pour une semi vu du dessus qui suit le personnage
2. Ses positions sont enregistrées
3. Après un délai → un ghost apparaît
4. Le ghost devient plateforme
5. La pièce scale selon comportement
6. Objectif implicite : atteindre une hauteur suffisante

---

# 3️⃣ SYSTÈMES TECHNIQUES

---

## A. Architecture de base

### Structure projet

```
/src
  main.js
  scene.js
  player.js
  room.js
  echoSystem.js
  stateManager.js
  shaders/
  utils/
```

---

## B. PLAYER SYSTEM

### 1. Controller

* Capsule ou cube
* RigidBody dynamique
* Collider capsule

Physics :

* Gravity active
* Linear damping faible
* Angular lock

---

### 2. Variables comportementales

```js
movementIntensity
idleTimer
totalDistanceTravelled
maxHeightReached
```

Update loop :

* Si vitesse > threshold → movementIntensity++
* Sinon → idleTimer++

---

## C. ECHO SYSTEM

Cœur du projet.

---

### 1. Recording

Toutes les 300ms :

```js
echoBuffer.push({
  position: player.position.clone(),
  timestamp: elapsedTime
})
```

Limiter taille buffer (ex: 200 entrées max)

---

### 2. Spawn

Après 3 secondes :

* Créer mesh ghost
* Matériau shader custom
* RigidBody type fixed au début
* Fade in progressif
* Après fade → RigidBody dynamic ou fixed selon choix

---

### 3. Lifecycle

Chaque echo :

* age++
* dissolve à 20s
* remove physics
* dispose geometry/material

Important pour perfs.

---

## D. ROOM SYSTEM (pièce réactive)

---

### 1. Structure

* 4 murs
* 1 sol
* 1 plafond

Meshes simples.

---

### 2. Réaction à l’activité

Créer une variable :

```js
roomEnergy
```

Calcul :

```js
roomEnergy = movementIntensity - idleTimer
roomEnergy = clamp(roomEnergy, -1, 1)
```

---

### 3. Effets sur la pièce

Si énergie positive :

* scaleY plafond++
* distance murs++
* lumière plus chaude

Si énergie négative :

* murs se rapprochent
* plafond descend
* fog density++
* lumière plus froide

Transitions via interpolation smooth :

```js
currentValue += (targetValue - currentValue) * 0.05
```

---

## E. OBJECTIF NARRATIF

Quand :

```js
maxHeightReached > threshold
```

Alors :

* Lumière intense
* Les murs disparaissent lentement
* Tous les ghosts restent figés
* Fade to white

Fin.

---

# 4️⃣ SHADERS

---

## A. Ghost Material

Effets :

* Fresnel edge glow
* Opacité variable
* Dissolve noise
* Légère distortion vertex

Uniforms :

```glsl
uTime
uDissolve
uOpacity
```

---

## B. Room Subtle Distortion

Quand énergie basse :

* léger vertex displacement
* breathing effect

---

# 5️⃣ ILLUSION D’ESPACE INFINI

Au lieu de scale global :

Repositionner les murs dynamiquement autour du joueur :

```js
wall.position.x = player.position.x ± roomWidth
```

Ainsi la pièce semble immense sans vraie scale.

---

# 6️⃣ FLOW COMPLET D’EXPÉRIENCE

---

## 0:00 — Silence

* Pièce blanche
* Lumière neutre

---

## 0:30 — Premiers échos

* Silhouettes apparaissent
* Le joueur comprend

---

## 1:30 — Compression

S’il est passif :

* pièce plus petite
* tension

---

## 2:00 — Construction verticale

* ghosts s’accumulent
* gameplay devient plateforme

---

## 3:00 — Climax

* sortie invisible au plafond
* lumière intense

---

## 3:30 — Fin

Texte simple :

> “This room was built by your behavior.”

---

