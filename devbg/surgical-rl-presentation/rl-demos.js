// Reinforcement Learning Interactive Demos with Three.js

// ==================== Parcel Placement Demo (Finite States) ====================

let parcelScene, parcelCamera, parcelRenderer;
let parcelTruck, parcelParcels = [], parcelGrid = [];
let parcelTraining = false;
let parcelEpisode = 0;
let parcelStep = 0;
let parcelTotalReward = 0;
let parcelPlaced = 0;
let parcelTotal = 0; // No fixed limit - parcels generated continuously
let parcelInitialTotal = 0; // Track total parcels attempted
let parcelQueue = []; // Parcels waiting to be placed
let parcelNextId = 0; // ID counter for parcels
let parcelQueueMeshes = []; // Visual representation of queued parcels
let parcelQTable = {};
let parcelEpsilon = 0.3;
let parcelAlpha = 0.1;
let parcelGamma = 0.9;
const MAX_Q_TABLE_SIZE = 10000; // Limit Q-table size to prevent memory issues
const MAX_QUEUE_SIZE = 50; // Maximum parcels in queue to prevent unbounded growth
const MAX_CONVEYOR_PARCELS = 20; // Maximum parcels on conveyor to prevent unbounded growth
let parcelGridWidth = 6;
let parcelGridDepth = 4;
let parcelGridHeight = 3;
let parcelConveyor = null; // Conveyor belt mesh
let parcelConveyorBelt = null; // Moving belt texture
let parcelConveyorParcels = []; // Parcels on the conveyor
let parcelConveyorSpeed = -0.05; // Speed of conveyor movement (negative = moving left towards room) - increased for faster movement
let parcelConveyorLength = 6; // Length of conveyor
let parcelConveyorStartX = parcelGridWidth / 2 + parcelConveyorLength; // Start position (right side, far from room)
let parcelConveyorEndX = parcelGridWidth / 2; // End position (at room edge, where placement happens)
let parcelNextSpawnTime = 0; // Time until next parcel spawns
let parcelSpawnInterval = 60; // Frames between parcel spawns (~1 second at 60fps)
let parcelMinSpacing = 1.5; // Minimum spacing between parcels on conveyor
let parcelTextures = {}; // Store loaded textures
let parcelAnimationId = null;
let parcelCurrentParcel = null;
// Removed parcelOccupiedCells - redundant with parcelGrid, was causing memory leak
let parcelSizes = []; // Track sizes for each parcel: {width: 1, depth: 1, height: 1}
let parcelQTableKeys = []; // Track Q-table keys for efficient cleanup (FIFO)
let parcelFrameCount = 0; // Frame counter for animation
let parcelTrainingInterval = null; // Store interval ID for cleanup
let parcelResizeHandler = null; // Store resize handler for cleanup
let parcelAnimationRunning = false; // Track if animation is running
let parcelResetTimeout = null; // Track reset timeout for cleanup
let parcelLastConveyorCheck = 0; // Throttle conveyor end checks
let parcelLastValidPlacementCheck = 0; // Throttle valid placement checks
let parcelPlacementInProgress = false; // Prevent recursive placement calls
const CONVEYOR_CHECK_INTERVAL = 5; // Only check conveyor every N frames
const VALID_PLACEMENT_CACHE_MS = 100; // Cache valid placement result for 100ms
let cachedValidPlacement = null;
let cachedValidPlacementTime = 0;

function initParcelPlacement() {
    const container = document.getElementById('parcelPlacementContainer');
    if (!container || parcelRenderer) return;

    // Scene setup
    parcelScene = new THREE.Scene();
    parcelScene.background = new THREE.Color(0x87CEEB);
    parcelScene.fog = new THREE.Fog(0x87CEEB, 5, 15);

    // Camera - zoomed out to see both room and queue
    parcelCamera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    // Position camera to see both truck (center) and queue (right side)
    // Center point between truck (x=0) and queue (x~5) is around x=2.5
    parcelCamera.position.set(2.5, 6, 7);
    parcelCamera.lookAt(2.5, 1, 0); // Look at center between truck and queue

    // Renderer
    parcelRenderer = new THREE.WebGLRenderer({ antialias: true });
    parcelRenderer.setSize(container.clientWidth, container.clientHeight);
    parcelRenderer.shadowMap.enabled = true;
    container.appendChild(parcelRenderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    parcelScene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    parcelScene.add(directionalLight);

    // Load textures
    loadParcelTextures();

    // Create truck
    createParcelTruck();

    // Create grid visualization
    createParcelGrid();

    // Create conveyor belt
    createParcelConveyor();

    // Initialize parcel queue
    initializeParcelQueue();

    // Initialize Q-table
    initializeParcelQTable();

    // Start animation loop
    animateParcel();

    // Handle resize (store handler for cleanup)
    parcelResizeHandler = () => {
        if (container && parcelRenderer) {
            parcelCamera.aspect = container.clientWidth / container.clientHeight;
            parcelCamera.updateProjectionMatrix();
            parcelRenderer.setSize(container.clientWidth, container.clientHeight);
        }
    };
    window.addEventListener('resize', parcelResizeHandler);
}

function loadParcelTextures() {
    const loader = new THREE.TextureLoader();
    
    // Create procedural textures using canvas
    // Parcel texture - cardboard pattern
    const parcelCanvas = document.createElement('canvas');
    parcelCanvas.width = 256;
    parcelCanvas.height = 256;
    const parcelCtx = parcelCanvas.getContext('2d');
    parcelCtx.fillStyle = '#d4a574';
    parcelCtx.fillRect(0, 0, 256, 256);
    // Add cardboard lines
    parcelCtx.strokeStyle = '#8b6f47';
    parcelCtx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
        parcelCtx.beginPath();
        parcelCtx.moveTo(0, i * 32);
        parcelCtx.lineTo(256, i * 32);
        parcelCtx.stroke();
        parcelCtx.beginPath();
        parcelCtx.moveTo(i * 32, 0);
        parcelCtx.lineTo(i * 32, 256);
        parcelCtx.stroke();
    }
    parcelTextures.parcel = new THREE.CanvasTexture(parcelCanvas);
    parcelTextures.parcel.wrapS = THREE.RepeatWrapping;
    parcelTextures.parcel.wrapT = THREE.RepeatWrapping;
    
    // Conveyor texture - rubber belt pattern
    const conveyorCanvas = document.createElement('canvas');
    conveyorCanvas.width = 512;
    conveyorCanvas.height = 64;
    const conveyorCtx = conveyorCanvas.getContext('2d');
    conveyorCtx.fillStyle = '#666666';
    conveyorCtx.fillRect(0, 0, 512, 64);
    // Add ribbed pattern
    for (let i = 0; i < 32; i++) {
        conveyorCtx.fillStyle = i % 2 === 0 ? '#777777' : '#555555';
        conveyorCtx.fillRect(i * 16, 0, 16, 64);
    }
    parcelTextures.conveyor = new THREE.CanvasTexture(conveyorCanvas);
    parcelTextures.conveyor.wrapS = THREE.RepeatWrapping;
    parcelTextures.conveyor.wrapT = THREE.RepeatWrapping;
    
    // Room/truck texture - metal/wood pattern
    const roomCanvas = document.createElement('canvas');
    roomCanvas.width = 256;
    roomCanvas.height = 256;
    const roomCtx = roomCanvas.getContext('2d');
    roomCtx.fillStyle = '#4a4a4a';
    roomCtx.fillRect(0, 0, 256, 256);
    // Add metal texture
    for (let i = 0; i < 256; i += 4) {
        roomCtx.fillStyle = i % 8 === 0 ? '#555555' : '#3a3a3a';
        roomCtx.fillRect(0, i, 256, 2);
    }
    parcelTextures.room = new THREE.CanvasTexture(roomCanvas);
    parcelTextures.room.wrapS = THREE.RepeatWrapping;
    parcelTextures.room.wrapT = THREE.RepeatWrapping;
}

function createParcelTruck() {
    const truckGroup = new THREE.Group();

    // Truck bed (open back) - with texture
    const bedGeometry = new THREE.BoxGeometry(parcelGridWidth, 0.2, parcelGridDepth);
    const bedMaterial = new THREE.MeshPhongMaterial({ 
        map: parcelTextures.room,
        color: 0xffffff
    });
    const bed = new THREE.Mesh(bedGeometry, bedMaterial);
    bed.position.y = 0.1;
    bed.receiveShadow = true;
    truckGroup.add(bed);

    // Truck walls - with texture
    const wallMaterial = new THREE.MeshPhongMaterial({ 
        map: parcelTextures.room,
        color: 0xffffff
    });
    
    // Left wall
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, parcelGridHeight, parcelGridDepth), wallMaterial);
    leftWall.position.set(-parcelGridWidth / 2, parcelGridHeight / 2, 0);
    truckGroup.add(leftWall);
    
    // Right wall
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, parcelGridHeight, parcelGridDepth), wallMaterial);
    rightWall.position.set(parcelGridWidth / 2, parcelGridHeight / 2, 0);
    truckGroup.add(rightWall);
    
    // Back wall
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(parcelGridWidth, parcelGridHeight, 0.2), wallMaterial);
    backWall.position.set(0, parcelGridHeight / 2, -parcelGridDepth / 2);
    truckGroup.add(backWall);

    parcelTruck = truckGroup;
    parcelScene.add(parcelTruck);
}

function createParcelGrid() {
    // Visual grid to show available positions
    const gridHelper = new THREE.GridHelper(parcelGridWidth, parcelGridWidth, 0x4ecdc4, 0x4ecdc4);
    gridHelper.position.y = 0.01;
    parcelScene.add(gridHelper);

    // Initialize grid cells
    for (let x = 0; x < parcelGridWidth; x++) {
        parcelGrid[x] = [];
        for (let z = 0; z < parcelGridDepth; z++) {
            parcelGrid[x][z] = [];
            for (let y = 0; y < parcelGridHeight; y++) {
                parcelGrid[x][z][y] = null; // null means empty
            }
        }
    }
}

function initializeParcelQueue() {
    // Start with a buffer of parcels
    parcelQueue = [];
    parcelInitialTotal = 0;
    parcelNextId = 0;
    
    // Generate initial buffer (e.g., 10 parcels)
    const bufferSize = 10;
    for (let i = 0; i < bufferSize; i++) {
        generateSingleParcel();
    }
}

function generateSingleParcel() {
    // Prevent unbounded queue growth
    if (parcelQueue.length >= MAX_QUEUE_SIZE) {
        return; // Don't generate if queue is full
    }
    
    // Generate a single parcel with random size
    const sizes = [
        {w: 1, d: 1, h: 1}, // Small
        {w: 2, d: 1, h: 1}, // Medium wide
        {w: 1, d: 2, h: 1}, // Medium deep
        {w: 1, d: 1, h: 2}, // Medium tall
        {w: 2, d: 2, h: 1}, // Large flat
    ];
    
    const size = sizes[Math.floor(Math.random() * sizes.length)];
    parcelQueue.push({
        id: parcelNextId++,
        width: size.w,
        depth: size.d,
        height: size.h
    });
    parcelInitialTotal++;
}

function createParcelConveyor() {
    const conveyorGroup = new THREE.Group();
    
    // Conveyor base/platform
    const baseGeometry = new THREE.BoxGeometry(parcelConveyorLength, 0.1, 1.5);
    const baseMaterial = new THREE.MeshPhongMaterial({ 
        map: parcelTextures.room,
        color: 0xffffff
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.set((parcelConveyorStartX + parcelConveyorEndX) / 2, 0.05, 0);
    base.receiveShadow = true;
    conveyorGroup.add(base);
    
    // Conveyor belt (moving surface) - with animated texture
    const beltGeometry = new THREE.PlaneGeometry(parcelConveyorLength, 1.2);
    const beltMaterial = new THREE.MeshPhongMaterial({ 
        map: parcelTextures.conveyor,
        color: 0xffffff,
        side: THREE.DoubleSide
    });
    const belt = new THREE.Mesh(beltGeometry, beltMaterial);
    belt.rotation.x = -Math.PI / 2;
    belt.position.set((parcelConveyorStartX + parcelConveyorEndX) / 2, 0.15, 0);
    belt.receiveShadow = true;
    conveyorGroup.add(belt);
    parcelConveyorBelt = belt;
    
    // Conveyor side rails
    const railMaterial = new THREE.MeshPhongMaterial({ 
        map: parcelTextures.room,
        color: 0xffffff
    });
    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(parcelConveyorLength, 0.3, 0.1), railMaterial);
    leftRail.position.set((parcelConveyorStartX + parcelConveyorEndX) / 2, 0.2, -0.6);
    conveyorGroup.add(leftRail);
    
    const rightRail = new THREE.Mesh(new THREE.BoxGeometry(parcelConveyorLength, 0.3, 0.1), railMaterial);
    rightRail.position.set((parcelConveyorStartX + parcelConveyorEndX) / 2, 0.2, 0.6);
    conveyorGroup.add(rightRail);
    
    parcelConveyor = conveyorGroup;
    parcelScene.add(parcelConveyor);
}

function createParcelQueueVisuals() {
    // This function is no longer used - parcels are on conveyor now
    // But keeping it for compatibility
}

function initializeParcelQTable() {
    // State: grid position (x, z, y) + parcel size (w, d, h)
    // For finite states, we enumerate all possible positions and sizes
    // Limit Q-table size to prevent memory issues - only initialize states that are likely to be used
    const sizes = [
        {w: 1, d: 1, h: 1}, // Small
        {w: 2, d: 1, h: 1}, // Medium wide
        {w: 1, d: 2, h: 1}, // Medium deep
        {w: 1, d: 1, h: 2}, // Medium tall
        {w: 2, d: 2, h: 1}, // Large flat
    ];
    
    // Only initialize Q-table entries when needed (lazy initialization)
    // This prevents memory bloat from unused states
    // The Q-table will be populated on-demand in chooseParcelAction
}

function getParcelState() {
    // State is the current grid position we're considering
    // Returns a simplified state for Q-learning (just parcel count)
    return `parcels:${parcelPlaced}`;
}

function canPlaceParcel(x, z, y, width, depth, height) {
    // Check if position is valid and all required cells are not occupied
    if (x < 0 || x + width > parcelGridWidth || 
        z < 0 || z + depth > parcelGridDepth || 
        y < 0 || y + height > parcelGridHeight) {
        return false;
    }
    
    // Check if all cells in the parcel's volume are empty
    for (let dx = 0; dx < width; dx++) {
        for (let dz = 0; dz < depth; dz++) {
            for (let dy = 0; dy < height; dy++) {
                if (parcelGrid[x + dx][z + dz][y + dy] !== null) {
                    return false;
                }
            }
        }
    }
    
    // Parcels must be placed on ground (y=0) or on top of another parcel
    // Check that the parcel's entire footprint has support below
    if (y > 0) {
        // Check that every cell in the parcel's base footprint has support
        for (let dx = 0; dx < width; dx++) {
            for (let dz = 0; dz < depth; dz++) {
                // Each cell in the footprint must have a parcel directly below
                if (parcelGrid[x + dx][z + dz][y - 1] === null) {
                    return false; // No support below this cell
                }
            }
        }
    }
    
    return true;
}

function getParcelReward(x, z, y, width, depth, height) {
    if (!canPlaceParcel(x, z, y, width, depth, height)) {
        return -10; // Invalid placement
    }
    
    // Reward compact placement (prefer lower positions, fill from back)
    let reward = 10; // Base reward for valid placement
    
    // Prefer lower layers
    reward += (parcelGridHeight - y) * 1;
    
    // Prefer filling from back to front
    reward += (parcelGridDepth - z) * 1;
    
    // Prefer center positions
    const centerX = parcelGridWidth / 2;
    const parcelCenterX = x + width / 2;
    reward += (1 - Math.abs(parcelCenterX - centerX) / centerX) * 1;
    
    // Reward efficient use of space (larger parcels are better if they fit)
    reward += (width * depth * height) * 0.5;
    
    // Reward stacking on existing parcels (efficient use of vertical space)
    if (y > 0) {
        reward += 2;
    }
    
    return reward;
}

function chooseParcelAction() {
    // This function is now mainly used for step-by-step mode
    // In automatic mode, parcels are placed when they reach conveyor end
    // Check if there's a parcel at the end of conveyor
    for (const conveyorParcel of parcelConveyorParcels) {
        if (conveyorParcel.x <= parcelConveyorEndX + 0.1) {
            return chooseParcelActionForParcel(conveyorParcel.parcel);
        }
    }
    return null;
}

function placeParcel(action) {
    const width = action.width || 1;
    const depth = action.depth || 1;
    const height = action.height || 1;
    
    if (!action || !canPlaceParcel(action.x, action.z, action.y, width, depth, height)) {
        return { reward: -10, done: false };
    }
    
    // Create parcel mesh with different sizes
    const baseSize = 0.8;
    const parcelWidth = width * baseSize;
    const parcelDepth = depth * baseSize;
    const parcelHeight = height * baseSize;
    
    const parcelGeometry = new THREE.BoxGeometry(parcelWidth, parcelHeight, parcelDepth);
    const colors = [0x4ecdc4, 0x45b7d1, 0xffa726, 0xab47bc, 0xef5350, 0x66bb6a, 0xec407a];
    const color = new THREE.Color(colors[parcelPlaced % colors.length]);
    
    // Reuse material with shared texture to reduce memory usage
    const parcelMaterial = new THREE.MeshPhongMaterial({ 
        map: parcelTextures.parcel,
        color: color,
        shininess: 30
    });
    // Mark material for disposal tracking
    parcelMaterial.userData.disposeOnRemove = true;
    const parcel = new THREE.Mesh(parcelGeometry, parcelMaterial);
    
    // Position in grid (center of the parcel)
    const worldX = (action.x + width / 2 - parcelGridWidth / 2) * baseSize;
    const worldZ = (action.z + depth / 2 - parcelGridDepth / 2) * baseSize;
    const worldY = (action.y + height / 2) * baseSize;
    
    parcel.position.set(worldX, worldY, worldZ);
    parcel.castShadow = true;
    parcelScene.add(parcel);
    
    // Mark all cells in the parcel's volume as occupied
    for (let dx = 0; dx < width; dx++) {
        for (let dz = 0; dz < depth; dz++) {
            for (let dy = 0; dy < height; dy++) {
                parcelGrid[action.x + dx][action.z + dz][action.y + dy] = parcel;
            }
        }
    }
    
    parcelParcels.push(parcel);
    parcelSizes.push({ width, depth, height });
    
    const reward = getParcelReward(action.x, action.z, action.y, width, depth, height);
    
    // Update Q-value using Q-learning
    // Find max Q-value for valid next actions (after this placement)
    let maxNextQ = 0;
    // Check next parcel from queue or conveyor
    let nextParcel = null;
    if (parcelQueue.length > 0) {
        nextParcel = parcelQueue[0];
    } else if (parcelConveyorParcels.length > 0) {
        nextParcel = parcelConveyorParcels[0].parcel;
    }
    
    if (nextParcel) {
        // Limit search to prevent performance issues (reduced from 300)
        const MAX_SEARCH_ITERATIONS = 150;
        let iterations = 0;
        for (let x = 0; x < parcelGridWidth && iterations < MAX_SEARCH_ITERATIONS; x++) {
            for (let z = 0; z < parcelGridDepth && iterations < MAX_SEARCH_ITERATIONS; z++) {
                for (let y = 0; y < parcelGridHeight && iterations < MAX_SEARCH_ITERATIONS; y++) {
                    iterations++;
                    if (canPlaceParcel(x, z, y, nextParcel.width, nextParcel.depth, nextParcel.height)) {
                        const stateKey = `${x},${z},${y},${nextParcel.width},${nextParcel.depth},${nextParcel.height}`;
                        const qValue = parcelQTable[stateKey] || 0;
                        if (qValue > maxNextQ) {
                            maxNextQ = qValue;
                        }
                    }
                }
            }
        }
    }
    
    // Limit Q-table size to prevent memory issues (efficient FIFO cleanup)
    if (parcelQTableKeys.length >= MAX_Q_TABLE_SIZE) {
        // Remove oldest entries (FIFO - remove first 10% of entries)
        const removeCount = Math.floor(parcelQTableKeys.length * 0.1);
        for (let i = 0; i < removeCount; i++) {
            const keyToRemove = parcelQTableKeys.shift();
            delete parcelQTable[keyToRemove];
        }
    }
    
    // Add new state to keys array if it doesn't exist
    if (!parcelQTable[action.state]) {
        parcelQTableKeys.push(action.state);
    }
    
    const currentQ = parcelQTable[action.state] || 0;
    parcelQTable[action.state] = currentQ + 
        parcelAlpha * (reward + parcelGamma * maxNextQ - currentQ);
    
    parcelPlaced++;
    
    // Generate a new parcel when one is placed (maintain buffer)
    // Only generate if episode is not done, queue is not full, and there are still valid placements possible
    // Use cached result to avoid expensive check
    if (!episodeEnded && parcelQueue.length < MAX_QUEUE_SIZE && hasValidPlacement(false)) {
        generateSingleParcel();
    }
    
    // Invalidate cache since grid changed
    cachedValidPlacement = null;
    
    // Episode continues until no more parcels can be placed
    // Check if episode should end (no parcels left OR no valid placements)
    const done = checkEpisodeDone();
    
    return { reward, done };
}

function hasValidPlacement(forceRecompute = false) {
    // Throttle expensive checks - cache result for a short time
    const now = Date.now();
    if (!forceRecompute && cachedValidPlacement !== null && (now - cachedValidPlacementTime) < VALID_PLACEMENT_CACHE_MS) {
        return cachedValidPlacement;
    }
    
    // Check if any parcel in queue or on conveyor can be placed
    // This is called only when needed (not every frame)
    // Limit check to first few parcels to avoid expensive computation
    const MAX_PARCELS_TO_CHECK = 3; // Reduced from 5
    const parcelsToCheck = [];
    
    // Add parcels from queue (limit to first few)
    for (let i = 0; i < Math.min(parcelQueue.length, MAX_PARCELS_TO_CHECK); i++) {
        parcelsToCheck.push(parcelQueue[i]);
    }
    
    // Add parcels from conveyor (limit to first few)
    for (let i = 0; i < Math.min(parcelConveyorParcels.length, MAX_PARCELS_TO_CHECK - parcelsToCheck.length); i++) {
        parcelsToCheck.push(parcelConveyorParcels[i].parcel);
    }
    
    if (parcelsToCheck.length === 0) {
        cachedValidPlacement = false;
        cachedValidPlacementTime = now;
        return false;
    }
    
    // Optimized: Check only a sample of positions first, then limited full search
    // This reduces computation when grid is mostly empty
    const MAX_TOTAL_CHECKS = 50; // Hard limit on total checks
    let totalChecks = 0;
    
    for (const parcel of parcelsToCheck) {
        if (totalChecks >= MAX_TOTAL_CHECKS) break;
        
        // Quick check: try common positions first (ground level, back of truck)
        const quickChecks = [
            [0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0]
        ];
        
        for (const [x, z, y] of quickChecks) {
            if (totalChecks >= MAX_TOTAL_CHECKS) break;
            totalChecks++;
            
            if (x + parcel.width <= parcelGridWidth && 
                z + parcel.depth <= parcelGridDepth && 
                y + parcel.height <= parcelGridHeight &&
                canPlaceParcel(x, z, y, parcel.width, parcel.depth, parcel.height)) {
                cachedValidPlacement = true;
                cachedValidPlacementTime = now;
                return true;
            }
        }
        
        // If quick check fails, do very limited full search (early exit on first valid)
        let checked = 0;
        const MAX_CHECKS = 30; // Further reduced to prevent freeze
        for (let x = 0; x < parcelGridWidth && checked < MAX_CHECKS && totalChecks < MAX_TOTAL_CHECKS; x++) {
            for (let z = 0; z < parcelGridDepth && checked < MAX_CHECKS && totalChecks < MAX_TOTAL_CHECKS; z++) {
                for (let y = 0; y < parcelGridHeight && checked < MAX_CHECKS && totalChecks < MAX_TOTAL_CHECKS; y++) {
                    checked++;
                    totalChecks++;
                    if (canPlaceParcel(x, z, y, parcel.width, parcel.depth, parcel.height)) {
                        cachedValidPlacement = true;
                        cachedValidPlacementTime = now;
                        return true; // Early exit on first valid placement
                    }
                }
            }
        }
    }
    
    cachedValidPlacement = false;
    cachedValidPlacementTime = now;
    return false;
}

let episodeEnded = false; // Flag to track if episode has ended

function checkEpisodeDone() {
    // Episode is done when:
    // 1. No more parcels in queue
    // 2. No parcels on conveyor
    // 3. No valid placements available for any remaining parcels
    if (parcelQueue.length === 0 && parcelConveyorParcels.length === 0) {
        return true; // No more parcels to process
    }
    
    // If there are parcels but none can be placed, episode is done
    // Use cached result to avoid expensive computation
    return !hasValidPlacement(false);
}

function disposeMesh(mesh) {
    if (!mesh) return;
    
    // Dispose geometry
    if (mesh.geometry) {
        mesh.geometry.dispose();
    }
    
    // Dispose material
    if (mesh.material) {
        // Handle array of materials
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach(mat => {
                if (mat.map) mat.map.dispose();
                mat.dispose();
            });
        } else {
            // Single material
            if (mesh.material.map) {
                // Don't dispose shared textures (parcel, conveyor, room textures)
                // Only dispose if it's a unique texture
                if (mesh.material.map !== parcelTextures.parcel && 
                    mesh.material.map !== parcelTextures.conveyor && 
                    mesh.material.map !== parcelTextures.room) {
                    mesh.material.map.dispose();
                }
            }
            mesh.material.dispose();
        }
    }
}

function resetParcelPlacement() {
    // Cancel any pending timeouts
    // (Note: We can't easily track all timeouts, but this helps)
    
    // Remove all placed parcels and dispose resources
    if (parcelScene) {
        parcelParcels.forEach(parcel => {
            parcelScene.remove(parcel);
            disposeMesh(parcel);
        });
    }
    parcelParcels = [];
    parcelSizes = [];
    
    // Remove queue visuals and dispose resources
    if (parcelScene) {
        parcelQueueMeshes.forEach(mesh => {
            parcelScene.remove(mesh);
            disposeMesh(mesh);
        });
    }
    parcelQueueMeshes = [];
    
    // Remove parcels on conveyor and dispose resources
    if (parcelScene) {
        parcelConveyorParcels.forEach(cp => {
            parcelScene.remove(cp.mesh);
            disposeMesh(cp.mesh);
        });
    }
    parcelConveyorParcels = [];
    
    // Clear grid
    for (let x = 0; x < parcelGridWidth; x++) {
        for (let z = 0; z < parcelGridDepth; z++) {
            for (let y = 0; y < parcelGridHeight; y++) {
                parcelGrid[x][z][y] = null;
            }
        }
    }
    
    // Clear Q-table keys array on reset (but keep some entries for learning)
    // Only clear if Q-table is getting too large
    if (parcelQTableKeys.length > MAX_Q_TABLE_SIZE * 0.8) {
        parcelQTableKeys = [];
        parcelQTable = {};
    }
    
    parcelStep = 0;
    parcelTotalReward = 0;
    parcelPlaced = 0;
    // Don't reset frame count - it's used for timing
    // parcelFrameCount = 0;
    parcelNextSpawnTime = parcelFrameCount; // Reset spawn time relative to current frame
    episodeEnded = false; // Reset episode flag
    parcelPlacementInProgress = false; // Reset placement flag
    parcelLastConveyorCheck = parcelFrameCount; // Reset conveyor check counter
    cachedValidPlacement = null; // Clear cache
    
    // Reinitialize queue with new random parcels
    initializeParcelQueue();
    
    updateParcelStats();
}

function stepParcelEpisode() {
    if (!parcelRenderer) return;
    
    // Check if episode is done
    if (checkEpisodeDone()) {
        parcelEpisode++;
        // Cancel any existing reset timeout
        if (parcelResetTimeout) {
            clearTimeout(parcelResetTimeout);
        }
        parcelResetTimeout = setTimeout(() => {
            parcelResetTimeout = null;
            resetParcelPlacement();
        }, 2000);
        return;
    }
    
    // In step mode, manually trigger placement if parcel is at end
    const action = chooseParcelAction();
    if (action) {
        const { reward, done } = placeParcel(action);
        parcelStep++;
        parcelTotalReward += reward;
        
        updateParcelStats();
        
        if (done) {
            parcelEpisode++;
            // Cancel any existing reset timeout
            if (parcelResetTimeout) {
                clearTimeout(parcelResetTimeout);
            }
            parcelResetTimeout = setTimeout(() => {
                parcelResetTimeout = null;
                resetParcelPlacement();
            }, 2000);
        }
    }
}

function updateParcelStats() {
    document.getElementById('parcelEpisodeCount').textContent = parcelEpisode;
    document.getElementById('parcelTotalReward').textContent = parcelTotalReward.toFixed(1);
    document.getElementById('parcelPlaced').textContent = parcelPlaced;
    
    // Efficiency: percentage of parcels attempted that were successfully placed
    const efficiency = parcelInitialTotal > 0 ? (parcelPlaced / parcelInitialTotal) * 100 : 0;
    document.getElementById('parcelEfficiency').textContent = efficiency.toFixed(0);
}

function toggleParcelTraining() {
    parcelTraining = !parcelTraining;
    document.getElementById('parcelTrainBtn').textContent = parcelTraining ? 'Stop Training' : 'Start Training';
    // Start or stop training interval based on state
    startParcelTrainingInterval();
}

// Auto-training loop
function startParcelTrainingInterval() {
    // Clear existing interval first
    if (parcelTrainingInterval) {
        clearInterval(parcelTrainingInterval);
        parcelTrainingInterval = null;
    }
    
    // Only start interval if training is enabled
    if (parcelTraining) {
        // Increased interval to reduce CPU load (300ms instead of 200ms)
        parcelTrainingInterval = setInterval(() => {
            if (parcelTraining && parcelRenderer && !episodeEnded) {
                stepParcelEpisode();
            } else {
                // Stop interval if training is disabled
                if (parcelTrainingInterval) {
                    clearInterval(parcelTrainingInterval);
                    parcelTrainingInterval = null;
                }
            }
        }, 300);
    }
}

function animateParcel() {
    if (parcelAnimationId || parcelAnimationRunning) return;
    parcelAnimationRunning = true;
    
    // Reset frame counter periodically to prevent overflow (every 1 million frames ~ 4.6 hours at 60fps)
    const MAX_FRAME_COUNT = 1000000;
    
    function animate() {
        if (!parcelRenderer || !parcelScene || !parcelCamera) {
            parcelAnimationId = null;
            parcelAnimationRunning = false;
            return;
        }
        
        parcelAnimationId = requestAnimationFrame(animate);
        parcelFrameCount++;
        
        // Reset frame counter periodically to prevent issues
        if (parcelFrameCount >= MAX_FRAME_COUNT) {
            parcelFrameCount = 0;
            parcelNextSpawnTime = 0;
        }
        
        // Only update if training is active (saves CPU when idle)
        if (parcelTraining) {
            // Update conveyor belt animation
            if (parcelConveyorBelt && parcelConveyorBelt.material.map) {
                // Animate belt texture (scrolling effect)
                parcelConveyorBelt.material.map.offset.x += 0.02;
            }
            
            // Spawn new parcels on conveyor (with spacing check)
            // Only check hasValidPlacement when we're actually ready to spawn (not every frame)
            if (parcelQueue.length > 0 && parcelFrameCount >= parcelNextSpawnTime && !episodeEnded) {
                // Only check if we should spawn (valid placements exist) when we're ready to spawn
                // Use cached result to avoid expensive check
                if (hasValidPlacement(false) && canSpawnParcelOnConveyor()) {
                    spawnParcelOnConveyor();
                    parcelNextSpawnTime = parcelFrameCount + parcelSpawnInterval;
                }
            }
            
            // Move parcels on conveyor
            updateConveyorParcels();
            
            // Throttle conveyor end checks to prevent excessive calls
            if (parcelFrameCount - parcelLastConveyorCheck >= CONVEYOR_CHECK_INTERVAL) {
                parcelLastConveyorCheck = parcelFrameCount;
                checkConveyorEnd();
            }
        }
        
        // Only render if there's something to show (or training is active)
        if (parcelTraining || parcelParcels.length > 0 || parcelConveyorParcels.length > 0) {
            parcelRenderer.render(parcelScene, parcelCamera);
        }
    }
    animate();
}

function stopParcelAnimation() {
    if (parcelAnimationId) {
        cancelAnimationFrame(parcelAnimationId);
        parcelAnimationId = null;
    }
    parcelAnimationRunning = false;
}

function cleanupParcelPlacement() {
    // Stop animation
    stopParcelAnimation();
    
    // Stop training interval
    if (parcelTrainingInterval) {
        clearInterval(parcelTrainingInterval);
        parcelTrainingInterval = null;
    }
    
    // Cancel reset timeout
    if (parcelResetTimeout) {
        clearTimeout(parcelResetTimeout);
        parcelResetTimeout = null;
    }
    
    // Remove resize listener
    if (parcelResizeHandler) {
        window.removeEventListener('resize', parcelResizeHandler);
        parcelResizeHandler = null;
    }
    
    // Dispose renderer
    if (parcelRenderer) {
        const container = document.getElementById('parcelPlacementContainer');
        if (container && parcelRenderer.domElement) {
            container.removeChild(parcelRenderer.domElement);
        }
        parcelRenderer.dispose();
        parcelRenderer = null;
    }
    
    // Clear scene
    if (parcelScene) {
        while(parcelScene.children.length > 0) {
            const obj = parcelScene.children[0];
            parcelScene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        }
        parcelScene = null;
    }
    
    parcelCamera = null;
    parcelTraining = false;
}

function canSpawnParcelOnConveyor() {
    // Check if there's enough space at the start of conveyor
    if (parcelConveyorParcels.length === 0) return true;
    
    // Find the rightmost parcel (highest x value, closest to start position)
    // Parcels spawn at startX and move left (decreasing x), so rightmost = highest x
    let rightmostX = -Infinity;
    for (const cp of parcelConveyorParcels) {
        if (cp.x > rightmostX) {
            rightmostX = cp.x;
        }
    }
    
    // Check if there's enough spacing between start position and rightmost parcel
    // Since parcels move left, rightmostX should be <= startX
    // We want at least minSpacing between them
    const spacing = parcelConveyorStartX - rightmostX;
    return spacing >= parcelMinSpacing;
}

function spawnParcelOnConveyor() {
    // Prevent unbounded conveyor growth
    if (parcelQueue.length === 0 || parcelConveyorParcels.length >= MAX_CONVEYOR_PARCELS) {
        return;
    }
    
    const parcel = parcelQueue.shift(); // Remove from queue when spawning
    const baseSize = 0.8;
    const parcelWidth = parcel.width * baseSize;
    const parcelDepth = parcel.depth * baseSize;
    const parcelHeight = parcel.height * baseSize;
    
    const parcelGeometry = new THREE.BoxGeometry(parcelWidth, parcelHeight, parcelDepth);
    
    // Create material with texture and color variation
    const colors = [0x4ecdc4, 0x45b7d1, 0xffa726, 0xab47bc, 0xef5350, 0x66bb6a, 0xec407a];
    const color = new THREE.Color(colors[parcelConveyorParcels.length % colors.length]);
    
    const parcelMaterial = new THREE.MeshPhongMaterial({ 
        map: parcelTextures.parcel,
        color: color,
        shininess: 30
    });
    const parcelMesh = new THREE.Mesh(parcelGeometry, parcelMaterial);
    
    parcelMesh.position.set(parcelConveyorStartX, parcelHeight / 2 + 0.15, 0);
    parcelMesh.castShadow = true;
    parcelScene.add(parcelMesh);
    
    parcelConveyorParcels.push({
        mesh: parcelMesh,
        parcel: parcel,
        x: parcelConveyorStartX
    });
}

function updateConveyorParcels() {
    // Move all parcels on conveyor
    for (let i = parcelConveyorParcels.length - 1; i >= 0; i--) {
        const conveyorParcel = parcelConveyorParcels[i];
        conveyorParcel.x += parcelConveyorSpeed;
        conveyorParcel.mesh.position.x = conveyorParcel.x;
    }
}

function checkConveyorEnd() {
    // Prevent recursive calls
    if (parcelPlacementInProgress) return;
    
    // Check if any parcel reached the end of conveyor
    // Parcels move from right to left (negative speed), so they reach end when x <= endX
    // Limit to processing one parcel per check to prevent cascade
    let processed = 0;
    const MAX_PROCESS_PER_CHECK = 1; // Only process one parcel per check
    
    for (let i = parcelConveyorParcels.length - 1; i >= 0 && processed < MAX_PROCESS_PER_CHECK; i--) {
        const conveyorParcel = parcelConveyorParcels[i];
        if (conveyorParcel.x <= parcelConveyorEndX) {
            // Parcel reached the end - try to place it
            const parcel = conveyorParcel.parcel;
            
            // Remove from conveyor and dispose
            if (parcelScene) {
                parcelScene.remove(conveyorParcel.mesh);
            }
            disposeMesh(conveyorParcel.mesh);
            parcelConveyorParcels.splice(i, 1);
            
            // Try to place the parcel
            attemptPlaceParcel(parcel);
            processed++;
        }
    }
}

function attemptPlaceParcel(parcel) {
    // Prevent recursive calls
    if (parcelPlacementInProgress) return;
    parcelPlacementInProgress = true;
    
    try {
        // Try to find a valid position for this parcel
        const action = chooseParcelActionForParcel(parcel);
        if (action) {
            const { reward, done } = placeParcel(action);
            parcelStep++;
            parcelTotalReward += reward;
            
            updateParcelStats();
            
            // Check if episode should end after this placement
            if (done) {
                episodeEnded = true;
                parcelEpisode++;
                // Cancel any existing reset timeout
                if (parcelResetTimeout) {
                    clearTimeout(parcelResetTimeout);
                }
                parcelResetTimeout = setTimeout(() => {
                    parcelResetTimeout = null;
                    resetParcelPlacement();
                }, 2000);
            }
        } else {
            // Can't place this parcel - but check if other parcels can still be placed
            // Episode only ends when NO parcels can be placed
            // Use cached result to avoid expensive check
            if (checkEpisodeDone()) {
                episodeEnded = true;
                parcelEpisode++;
                // Cancel any existing reset timeout
                if (parcelResetTimeout) {
                    clearTimeout(parcelResetTimeout);
                }
                parcelResetTimeout = setTimeout(() => {
                    parcelResetTimeout = null;
                    resetParcelPlacement();
                }, 2000);
            }
            // If episode is not done, continue with other parcels
        }
    } finally {
        parcelPlacementInProgress = false;
    }
}

function chooseParcelActionForParcel(parcel) {
    const width = parcel.width;
    const depth = parcel.depth;
    const height = parcel.height;
    
    // Limit search iterations to prevent freezing (reduced from 500)
    const MAX_SEARCH_ITERATIONS = 200;
    let iterations = 0;
    
    // Epsilon-greedy: explore random position or exploit best known
    if (Math.random() < parcelEpsilon) {
        // Explore: random valid position for this parcel
        const validActions = [];
        const MAX_VALID_ACTIONS = 20; // Reduced from 50 to prevent memory issues
        for (let x = 0; x < parcelGridWidth && iterations < MAX_SEARCH_ITERATIONS && validActions.length < MAX_VALID_ACTIONS; x++) {
            for (let z = 0; z < parcelGridDepth && iterations < MAX_SEARCH_ITERATIONS && validActions.length < MAX_VALID_ACTIONS; z++) {
                for (let y = 0; y < parcelGridHeight && iterations < MAX_SEARCH_ITERATIONS && validActions.length < MAX_VALID_ACTIONS; y++) {
                    iterations++;
                    if (canPlaceParcel(x, z, y, width, depth, height)) {
                        const stateKey = `${x},${z},${y},${width},${depth},${height}`;
                        validActions.push({ 
                            x, z, y, 
                            width, depth, height, 
                            parcelId: parcel.id,
                            state: stateKey 
                        });
                        // Early exit if we have enough options
                        if (validActions.length >= MAX_VALID_ACTIONS) break;
                    }
                }
                if (validActions.length >= MAX_VALID_ACTIONS) break;
            }
            if (validActions.length >= MAX_VALID_ACTIONS) break;
        }
        if (validActions.length === 0) return null;
        return validActions[Math.floor(Math.random() * validActions.length)];
    } else {
        // Exploit: best Q-value for this parcel size
        let bestAction = null;
        let bestQ = -Infinity;
        iterations = 0;
        
        for (let x = 0; x < parcelGridWidth && iterations < MAX_SEARCH_ITERATIONS; x++) {
            for (let z = 0; z < parcelGridDepth && iterations < MAX_SEARCH_ITERATIONS; z++) {
                for (let y = 0; y < parcelGridHeight && iterations < MAX_SEARCH_ITERATIONS; y++) {
                    iterations++;
                    if (canPlaceParcel(x, z, y, width, depth, height)) {
                        const stateKey = `${x},${z},${y},${width},${depth},${height}`;
                        const qValue = parcelQTable[stateKey] || 0;
                        if (qValue > bestQ) {
                            bestQ = qValue;
                            bestAction = { 
                                x, z, y, 
                                width, depth, height, 
                                parcelId: parcel.id,
                                state: stateKey 
                            };
                        }
                    }
                }
            }
        }
        return bestAction;
    }
}

// ==================== Car Parking Demo (Infinite/Continuous States) ====================

let parkingScene, parkingCamera, parkingRenderer;
let parkingCar, parkingSpot, parkingObstacles = [];
let parkingTraining = false;
let parkingEpisode = 0;
let parkingStep = 0;
let parkingTotalReward = 0;
let parkingQTable = {};
let parkingEpsilon = 0.3;
let parkingAlpha = 0.1;
let parkingGamma = 0.9;
let parkingCarState = { x: -4, y: 0, angle: 0, velocity: 0, angularVelocity: 0 };
let parkingSpotPosition = { x: 0, y: 0, angle: 0 };
let parkingSpotSize = { length: 2.5, width: 1.2 };
let parkingAnimationId = null;
let parkingNeuralNetwork = null; // For continuous states, we'd use function approximation

function initCarParking() {
    const container = document.getElementById('carParkingContainer');
    if (!container || parkingRenderer) return;

    // Scene setup
    parkingScene = new THREE.Scene();
    parkingScene.background = new THREE.Color(0x2a2a2a);
    parkingScene.fog = new THREE.Fog(0x2a2a2a, 5, 20);

    // Camera
    parkingCamera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    parkingCamera.position.set(0, 8, 10);
    parkingCamera.lookAt(0, 0, 0);

    // Renderer
    parkingRenderer = new THREE.WebGLRenderer({ antialias: true });
    parkingRenderer.setSize(container.clientWidth, container.clientHeight);
    parkingRenderer.shadowMap.enabled = true;
    container.appendChild(parkingRenderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    parkingScene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    parkingScene.add(directionalLight);

    // Create parking environment
    createParkingEnvironment();

    // Create car
    createParkingCar();

    // Create parking spot
    createParkingSpot();

    // Initialize Q-table (discretized for demo, but represents continuous space)
    initializeParkingQTable();

    // Start animation loop
    animateParking();

    // Handle resize
    window.addEventListener('resize', () => {
        if (container && parkingRenderer) {
            parkingCamera.aspect = container.clientWidth / container.clientHeight;
            parkingCamera.updateProjectionMatrix();
            parkingRenderer.setSize(container.clientWidth, container.clientHeight);
        }
    });
}

function createParkingEnvironment() {
    // Ground
    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.MeshPhongMaterial({ color: 0x444444 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    parkingScene.add(ground);

    // Parking lines
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffff00 });
    
    // Create parking space lines
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-parkingSpotSize.width / 2, 0.01, -parkingSpotSize.length / 2),
        new THREE.Vector3(parkingSpotSize.width / 2, 0.01, -parkingSpotSize.length / 2),
        new THREE.Vector3(parkingSpotSize.width / 2, 0.01, parkingSpotSize.length / 2),
        new THREE.Vector3(-parkingSpotSize.width / 2, 0.01, parkingSpotSize.length / 2),
        new THREE.Vector3(-parkingSpotSize.width / 2, 0.01, -parkingSpotSize.length / 2)
    ]);
    const parkingLines = new THREE.Line(lineGeometry, lineMaterial);
    parkingScene.add(parkingLines);

    // Obstacles (other cars)
    const obstaclePositions = [
        { x: 2.5, z: 0 },
        { x: -2.5, z: 0 },
        { x: 0, z: 3 }
    ];

    obstaclePositions.forEach(pos => {
        const obstacleGeometry = new THREE.BoxGeometry(1.8, 1.2, 3.5);
        const obstacleMaterial = new THREE.MeshPhongMaterial({ color: 0x666666 });
        const obstacle = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
        obstacle.position.set(pos.x, 0.6, pos.z);
        obstacle.castShadow = true;
        parkingObstacles.push(obstacle);
        parkingScene.add(obstacle);
    });
}

function createParkingCar() {
    const carGroup = new THREE.Group();

    // Car body
    const bodyGeometry = new THREE.BoxGeometry(1.6, 0.8, 3.2);
    const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x45b7d1 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.5;
    body.castShadow = true;
    carGroup.add(body);

    // Car roof
    const roofGeometry = new THREE.BoxGeometry(1.4, 0.6, 1.8);
    const roofMaterial = new THREE.MeshPhongMaterial({ color: 0x4ecdc4 });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.set(0, 1.1, -0.2);
    roof.castShadow = true;
    carGroup.add(roof);

    // Wheels
    const wheelGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.2, 16);
    const wheelMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 });
    const wheelPositions = [
        { x: -0.6, z: 1.0 },
        { x: 0.6, z: 1.0 },
        { x: -0.6, z: -1.0 },
        { x: 0.6, z: -1.0 }
    ];
    wheelPositions.forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(pos.x, 0.25, pos.z);
        wheel.castShadow = true;
        carGroup.add(wheel);
    });

    parkingCar = carGroup;
    parkingCar.position.set(parkingCarState.x, 0, parkingCarState.y);
    parkingScene.add(parkingCar);
}

function createParkingSpot() {
    // Visual indicator for parking spot
    const spotGeometry = new THREE.PlaneGeometry(parkingSpotSize.width, parkingSpotSize.length);
    const spotMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x4ecdc4, 
        transparent: true, 
        opacity: 0.3 
    });
    const spot = new THREE.Mesh(spotGeometry, spotMaterial);
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(parkingSpotPosition.x, 0.01, parkingSpotPosition.y);
    parkingScene.add(spot);
}

function initializeParkingQTable() {
    // For continuous states, we discretize the state space
    // In a real implementation, we'd use function approximation (neural network)
    // State: (x, y, angle, velocity, angularVelocity) -> discretized
}

function getParkingState() {
    // Discretize continuous state for Q-table lookup
    // In practice, this would be handled by a neural network
    const xBin = Math.floor((parkingCarState.x + 5) / 0.5);
    const yBin = Math.floor((parkingCarState.y + 5) / 0.5);
    const angleBin = Math.floor((parkingCarState.angle + Math.PI) / (Math.PI / 8));
    const velBin = Math.floor((parkingCarState.velocity + 2) / 0.5);
    const angVelBin = Math.floor((parkingCarState.angularVelocity + 1) / 0.2);
    
    return `${xBin},${yBin},${angleBin},${velBin},${angVelBin}`;
}

function isParkingCollision() {
    const carBounds = {
        x: parkingCarState.x,
        y: parkingCarState.y,
        width: 1.6,
        length: 3.2
    };
    
    // Check collision with obstacles
    for (const obstacle of parkingObstacles) {
        const obsPos = obstacle.position;
        if (Math.abs(carBounds.x - obsPos.x) < 1.5 && Math.abs(carBounds.y - obsPos.z) < 2.0) {
            return true;
        }
    }
    
    // Check boundaries
    if (Math.abs(carBounds.x) > 8 || Math.abs(carBounds.y) > 8) {
        return true;
    }
    
    return false;
}

function isParkingSuccess() {
    const dx = parkingCarState.x - parkingSpotPosition.x;
    const dy = parkingCarState.y - parkingSpotPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angleDiff = Math.abs(parkingCarState.angle - parkingSpotPosition.angle);
    const normalizedAngle = Math.min(angleDiff, 2 * Math.PI - angleDiff);
    
    return distance < 0.3 && normalizedAngle < 0.2 && Math.abs(parkingCarState.velocity) < 0.1;
}

function getParkingReward() {
    if (isParkingCollision()) {
        return -100;
    }
    
    if (isParkingSuccess()) {
        return 100;
    }
    
    // Reward based on distance to goal
    const dx = parkingCarState.x - parkingSpotPosition.x;
    const dy = parkingCarState.y - parkingSpotPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angleDiff = Math.abs(parkingCarState.angle - parkingSpotPosition.angle);
    const normalizedAngle = Math.min(angleDiff, 2 * Math.PI - angleDiff);
    
    // Reward getting closer and aligning
    const distanceReward = -distance * 2;
    const angleReward = -normalizedAngle * 10;
    const velocityPenalty = -Math.abs(parkingCarState.velocity) * 5;
    
    return distanceReward + angleReward + velocityPenalty;
}

function chooseParkingAction() {
    const actions = ['forward', 'backward', 'left', 'right', 'brake'];
    const state = getParkingState();
    
    if (!parkingQTable[state]) {
        parkingQTable[state] = {};
        actions.forEach(a => parkingQTable[state][a] = 0);
    }
    
    // Epsilon-greedy
    if (Math.random() < parkingEpsilon) {
        return actions[Math.floor(Math.random() * actions.length)];
    }
    
    // Exploit
    let bestAction = actions[0];
    let bestValue = parkingQTable[state][bestAction] || 0;
    for (const action of actions) {
        const value = parkingQTable[state][action] || 0;
        if (value > bestValue) {
            bestValue = value;
            bestAction = action;
        }
    }
    return bestAction;
}

function executeParkingAction(action) {
    const DT = 0.1;
    const MAX_VELOCITY = 2.0;
    const MAX_ANGULAR_VELOCITY = 1.0;
    
    switch (action) {
        case 'forward':
            parkingCarState.velocity = Math.min(parkingCarState.velocity + 0.3, MAX_VELOCITY);
            break;
        case 'backward':
            parkingCarState.velocity = Math.max(parkingCarState.velocity - 0.3, -MAX_VELOCITY);
            break;
        case 'left':
            parkingCarState.angularVelocity = Math.min(parkingCarState.angularVelocity + 0.2, MAX_ANGULAR_VELOCITY);
            break;
        case 'right':
            parkingCarState.angularVelocity = Math.max(parkingCarState.angularVelocity - 0.2, -MAX_ANGULAR_VELOCITY);
            break;
        case 'brake':
            parkingCarState.velocity *= 0.8;
            parkingCarState.angularVelocity *= 0.8;
            break;
    }
    
    // Update position and angle
    parkingCarState.angle += parkingCarState.angularVelocity * DT;
    parkingCarState.x += Math.cos(parkingCarState.angle) * parkingCarState.velocity * DT;
    parkingCarState.y += Math.sin(parkingCarState.angle) * parkingCarState.velocity * DT;
    
    // Apply friction
    parkingCarState.velocity *= 0.95;
    parkingCarState.angularVelocity *= 0.95;
    
    // Update car visual
    parkingCar.position.set(parkingCarState.x, 0, parkingCarState.y);
    parkingCar.rotation.y = parkingCarState.angle;
    
    const reward = getParkingReward();
    const done = isParkingSuccess() || isParkingCollision();
    
    // Update Q-value
    const state = getParkingState();
    const nextState = getParkingState();
    if (!parkingQTable[state]) {
        parkingQTable[state] = {};
    }
    if (!parkingQTable[nextState]) {
        parkingQTable[nextState] = {};
    }
    
    const maxNextQ = Math.max(...Object.values(parkingQTable[nextState]).map(v => v || 0));
    const currentQ = parkingQTable[state][action] || 0;
    parkingQTable[state][action] = currentQ + parkingAlpha * (reward + parkingGamma * maxNextQ - currentQ);
    
    return { reward, done };
}

function resetCarParking() {
    parkingCarState = { 
        x: -4 + (Math.random() - 0.5) * 2, 
        y: -2 + (Math.random() - 0.5) * 2, 
        angle: Math.random() * Math.PI * 2,
        velocity: 0, 
        angularVelocity: 0 
    };
    parkingCar.position.set(parkingCarState.x, 0, parkingCarState.y);
    parkingCar.rotation.y = parkingCarState.angle;
    parkingStep = 0;
    parkingTotalReward = 0;
    updateParkingStats();
}

function stepParkingEpisode() {
    if (!parkingRenderer) return;
    if (parkingStep > 200 || isParkingSuccess() || isParkingCollision()) {
        resetCarParking();
        parkingEpisode++;
        return;
    }
    
    const action = chooseParkingAction();
    const { reward, done } = executeParkingAction(action);
    
    parkingStep++;
    parkingTotalReward += reward;
    
    updateParkingStats();
    
    if (done || parkingStep > 200) {
        parkingEpisode++;
        if (isParkingSuccess()) {
            setTimeout(() => resetCarParking(), 1000);
        } else {
            resetCarParking();
        }
    }
}

function updateParkingStats() {
    document.getElementById('parkingEpisodeCount').textContent = parkingEpisode;
    document.getElementById('parkingTotalReward').textContent = parkingTotalReward.toFixed(1);
    
    const dx = parkingCarState.x - parkingSpotPosition.x;
    const dy = parkingCarState.y - parkingSpotPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    document.getElementById('parkingDistance').textContent = distance.toFixed(2);
    
    document.getElementById('parkingStatus').textContent = isParkingSuccess() ? 'Yes!' : 'No';
    document.getElementById('parkingStatus').style.color = isParkingSuccess() ? '#4ecdc4' : '#aaa';
}

function toggleParkingTraining() {
    parkingTraining = !parkingTraining;
    document.getElementById('parkingTrainBtn').textContent = parkingTraining ? 'Stop Training' : 'Start Training';
}

// Auto-training loop
setInterval(() => {
    if (parkingTraining && parkingRenderer) {
        stepParkingEpisode();
    }
}, 50);

function animateParking() {
    if (parkingAnimationId) return;
    
    function animate() {
        parkingAnimationId = requestAnimationFrame(animate);
        if (parkingRenderer && parkingScene && parkingCamera) {
            // Update camera to follow car
            parkingCamera.position.set(
                parkingCarState.x,
                8,
                parkingCarState.y + 10
            );
            parkingCamera.lookAt(parkingCarState.x, 0, parkingCarState.y);
            parkingRenderer.render(parkingScene, parkingCamera);
        }
    }
    animate();
}
