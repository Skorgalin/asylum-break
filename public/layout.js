// Building layout shared by the server (require) and the browser (classic script → window.LAYOUT).
// Three floors of 180 × 132 units: a main corridor runs east–west at z = ±5, a cross corridor
// north–south at x = ±5, and halls sit at both ends (x = ±78). Staircases are placed at random in
// rooms each time the server starts (see STAIR_SEED below), so the way up changes from game to game.
// Walls are axis aligned; doors are gaps in them (closed doors are only painted on).
(function (root) {
  'use strict';

  const FLOOR_Y = [0, 9, 18];
  const FLOOR_NAMES = ['GROUND', 'MEDICAL', 'WARD'];
  const WALL_HEIGHT = 5.6;
  const WALL_THICKNESS = 0.6;
  const DOOR_WIDTH = 3.4;
  const DOOR_HEIGHT = 4.3;
  // Where a player's centre may go: the outer walls' inner faces minus the player radius.
  const BOUNDS = { x: 88.3, z: 64.3 };

  const SPAWNS = {
    orderly: { floor: 0, x: 22, z: -12 },
    medic: { floor: 1, x: -36, z: -22 },
    director: { floor: 1, x: 66, z: 40 },
    patient: { floor: 2, x: -26, z: -9 }, // in cell WS3
  };

  // What the vending machines stock. Patient gear sits in patient areas, staff gear in staff rooms,
  // snacks in the corridors. Pools may list an item more than once (that only matters for random loot).
  const LOOT = {
    patient: [
      'glassShard', 'tableLeg', 'tableLeg', 'scrapMetal', 'scrapMetal', 'crowbar', 'glassBlade', 'woodenBat', 'steelBat',
      'crutch', 'pipeSword', 'fireAxe', 'rebarHammer', 'fireBottle', 'pipeBomb', 'nailBomb', 'stickyBomb', 'floorMine',
      'shoulderCharge', 'scream', 'rallyFlag', 'berserkPills', 'adrenalineShot', 'stolenScrubs', 'orderlyUniform',
      'directorSuit', 'cardboardBox', 'pottedShrub', 'gasMask', 'gasMask', 'signalJammer',
      'laundry', 'laundry', 'laundry', 'paintbrush', 'contraband', 'contraband', 'smuggledGoods', 'keycard', 'nightVision', 'stolenRadio',
    ],
    staff: [
      'twinBaton', 'shockRod', 'pocketStunner', 'shockSpear', 'wrench', 'sledgehammer', 'janitorMop', 'voltShield',
      'barrierShield', 'heavyShield', 'taserRifle', 'stunPistol', 'laserPistol', 'pepperballGun', 'netLauncher',
      'shockLasso', 'proximityTaser', 'flashGrenade', 'empGrenade', 'chargedEmp', 'gasGrenade', 'empLauncher',
      'gasLauncher', 'empMine', 'firemansCarry', 'combatVest', 'fireExtinguisher', 'weldingTorch', 'flashlight', 'flashlight', 'combatDrone', 'reconDrone',
    ],
    medical: [
      'smallMedicalKit', 'mediumMedicalKit', 'largeMedicalKit', 'mediGun', 'healingGrenade', 'therapyGrenade',
      'sedationPulse', 'straitjacket', 'firemansCarry', 'laserPistol', 'therapyTurret',
    ],
    common: ['coffee', 'coffee', 'tea', 'bread', 'bread', 'mango', 'candy', 'energySoda', 'tomato', 'snowball', 'smallMedicalKit', 'laundry', 'contraband'],
  };
  // Vending machines, each against a wall: `rot` turns its front away from the wall (0 faces +z, 1 +x,
  // 2 -z, 3 -x). Press E in front of one to take an item from its pool, for free for now.
  const VENDING_LABELS = { patient: 'Vending machine', staff: 'Supply machine', medical: 'Medical vending', common: 'Snack machine' };
  const VENDING = [
    // Patient ward.
    { floor: 2, x: -6.4, z: 50, rot: 3, pool: 'patient' }, { floor: 2, x: 6.4, z: -24, rot: 1, pool: 'patient' },
    { floor: 2, x: 30, z: 18.4, rot: 0, pool: 'patient' }, { floor: 2, x: -28, z: -18.4, rot: 2, pool: 'patient' },
    { floor: 2, x: 75, z: -63.6, rot: 0, pool: 'patient' }, { floor: 2, x: 86, z: 48.6, rot: 2, pool: 'patient' },
    { floor: 2, x: -87.6, z: -56, rot: 1, pool: 'medical' },
    { floor: 2, x: -3.6, z: -55, rot: 1, pool: 'common' }, { floor: 2, x: 3.6, z: 55, rot: 3, pool: 'common' },
    // Medical floor.
    { floor: 1, x: -6.4, z: -28, rot: 3, pool: 'medical' }, { floor: 1, x: -38.6, z: -46, rot: 1, pool: 'medical' },
    { floor: 1, x: -10, z: 6.4, rot: 0, pool: 'staff' }, { floor: 1, x: 80, z: -63.6, rot: 0, pool: 'staff' },
    { floor: 1, x: 6.4, z: 34, rot: 1, pool: 'staff' }, { floor: 1, x: -6.4, z: 56, rot: 3, pool: 'patient' },
    { floor: 1, x: 3.6, z: -58, rot: 3, pool: 'common' }, { floor: 1, x: 30, z: 3.6, rot: 2, pool: 'common' },
    // Ground floor.
    { floor: 0, x: -66.6, z: -30, rot: 1, pool: 'common' }, { floor: 0, x: -66.6, z: -24, rot: 1, pool: 'patient' },
    { floor: 0, x: 38.6, z: -36, rot: 3, pool: 'staff' }, { floor: 0, x: 87.6, z: -50, rot: 3, pool: 'staff' },
    { floor: 0, x: -10, z: 40.6, rot: 2, pool: 'common' }, { floor: 0, x: 87.6, z: 38, rot: 3, pool: 'patient' },
    { floor: 0, x: -30, z: 3.6, rot: 2, pool: 'common' },
  ];
  const FRONT = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  // Things to press E at. Shops sell to one team; jobs need their item in your inventory; the breaker
  // cuts (patients) or restores (staff) the lights; the exit lets patients with a way out escape.
  const STATIONS = [
    { id: 'shopWard', type: 'shop', team: 'patient', label: 'Commissary', floor: 2, x: -10, z: 21.5 },
    { id: 'shopVisit', type: 'shop', team: 'patient', label: 'Commissary', floor: 0, x: 43, z: 26.4 },
    { id: 'shopStaff', type: 'shop', team: 'staff', label: 'Supply terminal', floor: 0, x: -64.4, z: -27 },
    ...[10, 15, 20, 25, 30].map((x, i) => ({ id: `washer${i}`, type: 'job', job: 'laundry', label: 'Washing machine', floor: 0, x, z: 26 })),
    { id: 'easelA', type: 'job', job: 'paint', label: 'Canvas', floor: 2, x: 44, z: -19.6 },
    { id: 'easelB', type: 'job', job: 'paint', label: 'Canvas', floor: 2, x: 12.4, z: -40 },
    { id: 'breaker', type: 'breaker', label: 'Breaker panel', floor: 0, x: 86, z: 20 },
    { id: 'exit', type: 'exit', label: 'Main exit', floor: 0, x: -36, z: -63.4 },
    ...VENDING.map((machine, i) => ({
      id: `vending${i}`, type: 'vending', pool: machine.pool, label: VENDING_LABELS[machine.pool], floor: machine.floor,
      x: machine.x + FRONT[machine.rot][0] * 2.1, z: machine.z + FRONT[machine.rot][1] * 2.1,
    })),
  ];
  const STATION_RANGE = 3.5;

  // Vehicles stay on the floor they start on (no driving up stairs). `team` decides who may drive,
  // `seats` how many ride, `speed` multiplies the driver's speed; vehicles with `ram` bowl enemies over.
  const VEHICLE_TYPES = {
    wheelchair: { name: 'Wheelchair', team: 'all', seats: 2, speed: 1, verb: 'Push' },
    golfCart: { name: 'Golf Cart', team: 'staff', seats: 2, speed: 1.8, verb: 'Drive', ram: { minSpeed: 10, damage: 12, stun: 2, push: 4 } },
    forklift: { name: 'Forklift', team: 'staff', seats: 1, speed: 1.25, verb: 'Drive', ram: { minSpeed: 6, damage: 8, stun: 1.5, push: 6 } },
  };
  const VEHICLES = [
    { type: 'wheelchair', floor: 2, x: -45, z: 0 }, { type: 'wheelchair', floor: 2, x: 40, z: 0 },
    { type: 'wheelchair', floor: 1, x: 45, z: 0 }, { type: 'golfCart', floor: 1, x: -45, z: 0 },
    { type: 'golfCart', floor: 0, x: 40, z: 0 }, { type: 'forklift', floor: 0, x: -40, z: 0 },
  ].map((spot, i) => ({ id: `vehicle${i}`, ...spot }));

  // Security cameras for the director's tablet: mounted at (x, z) under the ceiling, looking at (tx, tz).
  const CAMERAS = [
    { label: 'Lobby', floor: 0, x: -36, z: -7, tx: -36, tz: -50 },
    { label: 'Cafeteria', floor: 0, x: -7, z: 7, tx: -40, tz: 30 },
    { label: 'Infirmary', floor: 1, x: -7, z: -7, tx: -40, tz: -25 },
    { label: 'Lab', floor: 1, x: 87, z: -63, tx: 40, tz: -40 },
    { label: 'Cells', floor: 2, x: -66, z: 0, tx: 20, tz: 0 },
    { label: 'Day room', floor: 2, x: -7, z: 63, tx: -50, tz: 30 },
    { label: 'Dorm', floor: 2, x: -7, z: -63, tx: -30, tz: -30 },
  ];

  const walls = FLOOR_Y.map(() => []);
  const rooms = FLOOR_Y.map(() => []);
  const furniture = FLOOR_Y.map(() => []);
  const signs = FLOOR_Y.map(() => []);

  // A wall from (x1, z1) to (x2, z2), either along x or along z. Doors are positions along the wall;
  // { at, closed: true } paints a locked door on without cutting a gap.
  function wall(floor, x1, z1, x2, z2, doors = [], options = {}) {
    walls[floor].push({
      x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2),
      thickness: options.thickness ?? WALL_THICKNESS, style: options.style ?? null,
      doors: doors.map(door => (typeof door === 'number' ? { at: door } : door)),
    });
  }
  const H = (floor, z, x1, x2, doors, options) => wall(floor, x1, z, x2, z, doors, options); // runs along x
  const V = (floor, x, z1, z2, doors, options) => wall(floor, x, z1, x, z2, doors, options); // runs along z
  function room(floor, name, x1, z1, x2, z2, style) {
    rooms[floor].push({ name, x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2), style });
  }
  // rot is in quarter turns; w runs along x and d along z before turning.
  function put(floor, type, x, z, rot = 0, size = {}) {
    furniture[floor].push({ type, x, z, rot, ...size });
  }
  // A sign on a wall. `face` is the direction it faces: '+x', '-x', '+z' or '-z'.
  function sign(floor, text, x, z, face, tint) {
    signs[floor].push({ text, x, z, face, tint });
  }

  // ---- Shared shell on every floor ---------------------------------------------------------
  for (let f = 0; f < FLOOR_Y.length; f++) {
    H(f, -65.5, -90, 90, f === 0 ? [{ at: -36, closed: true, exit: true }] : [], { thickness: 1 });
    H(f, 65.5, -90, 90, [], { thickness: 1 });
    V(f, -89.5, -65, 65, [], { thickness: 1 });
    V(f, 89.5, -65, 65, [], { thickness: 1 });
    room(f, 'Corridor', -68, -5, 68, 5, 'corridor');
    room(f, 'Corridor', -5, -65, 5, -5, 'corridor');
    room(f, 'Corridor', -5, 5, 5, 65, 'corridor');
    for (const side of [-1, 1]) {
      room(f, side > 0 ? 'East Hall' : 'West Hall', side * 68, -14, side * 89, 10, 'stairs');
      put(f, 'plant', side * 86, 7.5); put(f, 'plant', side * 86, -11.5);
      put(f, 'bench', side * 87.6, -1.5, 1, { w: 6 });
    }
  }

  // ---- Ground floor: lobby, security, cafeteria, gym -----------------------------------------
  {
    const f = 0;
    // Corridor walls.
    H(f, -5, -68, -5, [-50, -22]);
    H(f, -5, 5, 68, [20, 52]);
    H(f, 5, -68, -5, [-50, -22]);
    H(f, 5, 5, 68, [22, 54]);
    V(f, -5, -65, -5, [-35]);
    V(f, 5, -65, -5, [-15, -45]);
    V(f, -5, 5, 65, [25, 54]);
    V(f, 5, 5, 65, [18, 48]);
    // Lobby (SW) and visitor lockers.
    room(f, 'Main Lobby', -68, -65, -5, -5, 'lobby');
    V(f, -68, -65, -5, [-40]);
    H(f, -14, -89, -68);
    room(f, 'Visitor Lockers', -89, -65, -68, -14, 'tile');
    sign(f, 'MAIN LOBBY', -36, -5.35, '+z', '#56d5e8');
    sign(f, 'EXIT', -36, -65 + 0.05, '+z', '#4fe08a');
    put(f, 'counter', -36, -46, 0, { w: 16, d: 2.2 });
    put(f, 'counter', -45, -42, 0, { w: 2.2, d: 6 });
    put(f, 'counter', -27, -42, 0, { w: 2.2, d: 6 });
    put(f, 'deskChair', -40, -48.8); put(f, 'deskChair', -32, -48.8);
    put(f, 'monitor', -40, -46.4, 2); put(f, 'monitor', -32, -46.4, 2);
    for (const x of [-60, -12]) for (const z of [-56, -30]) put(f, 'pillar', x, z);
    for (const z of [-24, -16]) { put(f, 'bench', -58, z, 0, { w: 10 }); put(f, 'bench', -16, z, 0, { w: 10 }); }
    put(f, 'rug', -36, -28, 0, { w: 16, d: 12 });
    put(f, 'sofa', -36, -33, 0); put(f, 'coffeeTable', -36, -28); put(f, 'sofa', -36, -23, 2);
    for (const x of [-66, -7]) for (const z of [-63, -7.5]) put(f, 'plant', x, z);
    for (const z of [-60, -52, -44, -28, -20]) put(f, 'lockers', -87.6, z, 1, { w: 7 });
    put(f, 'bench', -78, -36, 1, { w: 8 });
    // Security (SE): office, holding cell, equipment, staff lockers, janitor.
    room(f, 'Security Office', 5, -26, 36, -5, 'office');
    room(f, 'Holding', 36, -26, 68, -5, 'concrete');
    room(f, 'Equipment', 5, -65, 40, -26, 'concrete');
    room(f, 'Staff Lockers', 40, -65, 89, -26, 'tile');
    room(f, 'Janitor', 68, -26, 89, -14, 'concrete');
    V(f, 36, -26, -5, [-15]);
    V(f, 68, -26, -5);
    H(f, -26, 5, 89, [20]);
    V(f, 40, -65, -26, [-45]);
    H(f, -14, 68, 89, [80]);
    sign(f, 'SECURITY', 20, -5.35, '+z', '#5aa9ff');
    sign(f, 'HOLDING', 52, -5.35, '+z', '#ff7d6b');
    put(f, 'monitorDesk', 20, -24.4, 0, { w: 18 });
    put(f, 'deskChair', 15, -21.5, 2); put(f, 'deskChair', 25, -21.5, 2);
    put(f, 'desk', 30, -11, 1); put(f, 'deskChair', 26.6, -11, 1);
    put(f, 'lockers', 6.4, -16, 1, { w: 10 });
    put(f, 'bars', 52, -18, 0, { w: 31.4 });
    put(f, 'cellBed', 46, -23.5, 1); put(f, 'cellBed', 58, -23.5, 1);
    put(f, 'toilet', 66.5, -24.5);
    for (const z of [-62.8, -28.2]) put(f, 'shelf', 22, z, 0, { w: 26 });
    put(f, 'crate', 12, -40); put(f, 'crate', 14.5, -42); put(f, 'crate', 32, -52); put(f, 'table', 22, -46, 0, { w: 8, d: 3.5 });
    for (const x of [48, 58, 68, 78]) put(f, 'lockers', x, -63.6, 0, { w: 8 });
    put(f, 'bench', 63, -48, 0, { w: 14 }); put(f, 'bench', 63, -40, 0, { w: 14 });
    put(f, 'lockers', 87.6, -36, 3, { w: 8 });
    put(f, 'shelf', 87.6, -20, 1, { w: 8 }); put(f, 'bucket', 72, -24);
    // Cafeteria and kitchen (NW), storage.
    room(f, 'Cafeteria', -68, 5, -5, 42, 'checker');
    room(f, 'Kitchen', -68, 42, -5, 65, 'tile');
    room(f, 'Storage', -89, 10, -68, 65, 'concrete');
    H(f, 42, -68, -5, [-20]);
    V(f, -68, 5, 65, [54]);
    H(f, 10, -89, -68);
    sign(f, 'CAFETERIA', -36, 5.35, '-z', '#ffcf5a');
    for (const x of [-56, -42, -28, -14]) for (const z of [14, 24, 34]) put(f, 'diningTable', x, z);
    put(f, 'counter', -44, 40.6, 0, { w: 30, d: 2.2 }); put(f, 'trays', -44, 40.6);
    put(f, 'counter', -26, 63.6, 0, { w: 30, d: 2.4 }); put(f, 'stove', -50, 63.6, 2); put(f, 'stove', -45, 63.6, 2);
    put(f, 'counter', -36, 53, 0, { w: 18, d: 4 });
    put(f, 'fridge', -66.4, 46, 1); put(f, 'fridge', -66.4, 49.5, 1);
    for (const z of [16, 26, 36, 46, 56]) put(f, 'shelf', -87.6, z, 1, { w: 8 });
    put(f, 'crate', -76, 30); put(f, 'crate', -73.5, 32.5); put(f, 'crate', -76, 35);
    // Laundry, visitor room, gym, electrical (NE).
    room(f, 'Laundry', 5, 5, 40, 30, 'tile');
    room(f, 'Visiting Room', 40, 5, 68, 30, 'wood');
    room(f, 'Gym', 5, 30, 89, 65, 'rubber');
    room(f, 'Electrical', 68, 10, 89, 30, 'concrete');
    V(f, 40, 5, 30);
    H(f, 30, 5, 89, [75]);
    V(f, 68, 5, 30);
    H(f, 10, 68, 89);
    sign(f, 'LAUNDRY', 22, 5.35, '-z', '#8fd0ff'); sign(f, 'VISITING', 54, 5.35, '-z', '#c5a3ff');
    for (const x of [10, 15, 20, 25, 30]) put(f, 'washer', x, 28.4, 2);
    put(f, 'table', 22, 16, 0, { w: 10, d: 3.5 }); put(f, 'laundryCart', 34, 12);
    for (const z of [12, 22]) for (const x of [47, 61]) { put(f, 'table', x, z, 0, { w: 6, d: 3 }); put(f, 'chair', x, z - 2.6); put(f, 'chair', x, z + 2.6, 2); }
    put(f, 'plant', 66, 28); put(f, 'vending', 43, 28.8, 2);
    for (const x of [16, 24, 32]) put(f, 'treadmill', x, 61, 2);
    put(f, 'benchPress', 46, 40); put(f, 'benchPress', 56, 40); put(f, 'weightRack', 51, 63.6, 2);
    put(f, 'mat', 72, 48, 0, { w: 14, d: 12 });
    put(f, 'rack', 87.6, 52, 3, { w: 6 });
    for (const z of [14, 20, 26]) put(f, 'electricBox', 88.4, z, 3);
    put(f, 'generator', 76, 20);
  }

  // ---- First floor: infirmary, OR, research lab, offices -----------------------------------
  {
    const f = 1;
    H(f, -5, -68, -5, [-50, -20]);
    H(f, -5, 5, 68, [20, 52]);
    H(f, 5, -68, -5, [-52, -20]);
    H(f, 5, 5, 68, [20, 52]);
    V(f, -5, -65, -5, [-20, -52]);
    V(f, 5, -65, -5, [-15, -45]);
    V(f, -5, 5, 65, [15, 45]);
    V(f, 5, 5, 65, [45]);
    // Infirmary (SW), pharmacy, archive, sterilisation.
    room(f, 'Infirmary', -68, -40, -5, -5, 'lino');
    room(f, 'Pharmacy', -40, -65, -5, -40, 'tile');
    room(f, 'Archive', -89, -65, -40, -40, 'wood');
    room(f, 'Sterilization', -89, -40, -68, -14, 'tile');
    H(f, -40, -89, -5, [-22, -60]);
    V(f, -40, -65, -40, [-52]);
    V(f, -68, -40, -5, [-28]);
    H(f, -14, -89, -68);
    sign(f, 'INFIRMARY', -35, -5.35, '+z', '#65d9ad');
    for (const x of [-62, -52, -42, -32, -22, -12]) {
      put(f, 'bed', x, -35.6);
      put(f, 'curtain', x + 4.5, -35.4, 1, { w: 8 });
      put(f, 'ivStand', x - 2.6, -38);
    }
    put(f, 'counter', -36, -14, 0, { w: 14, d: 2.4 }); put(f, 'monitor', -38, -14, 2); put(f, 'deskChair', -38, -16.6);
    put(f, 'cabinet', -66.4, -16, 1, { w: 5 });
    for (const z of [-62.8, -42.2]) put(f, 'medShelf', -22, z, 0, { w: 28 });
    put(f, 'counter', -22, -52, 0, { w: 12, d: 2.4 });
    for (const x of [-84, -76, -68, -60, -52, -46]) put(f, 'fileCabinet', x, -63.6);
    put(f, 'shelf', -64, -52, 0, { w: 14 }); put(f, 'shelf', -78, -52, 0, { w: 14 });
    put(f, 'counter', -87.6, -27, 1, { w: 18, d: 2.4 }); put(f, 'sterilizer', -76, -38.4);
    // Operating room, exam room, research lab, cold storage (SE).
    room(f, 'Operating Room', 5, -26, 36, -5, 'lino');
    room(f, 'Exam Room', 36, -26, 68, -5, 'lino');
    room(f, 'Research Lab', 5, -65, 89, -26, 'lab');
    room(f, 'Cold Storage', 68, -26, 89, -14, 'concrete');
    V(f, 36, -26, -5);
    V(f, 68, -26, -5);
    H(f, -26, 5, 89, [20, 80]);
    H(f, -14, 68, 89);
    sign(f, 'SURGERY', 20, -5.35, '+z', '#ff7d6b'); sign(f, 'EXAM', 52, -5.35, '+z', '#65d9ad');
    sign(f, 'RESEARCH · RESTRICTED', 47, -26 - 0.35, '+z', '#b39aff');
    put(f, 'operatingTable', 20, -16); put(f, 'surgicalLamp', 20, -16); put(f, 'cabinet', 34.6, -18, 3, { w: 6 }); put(f, 'ivStand', 16, -13);
    put(f, 'monitorCart', 25, -12);
    put(f, 'examBed', 52, -22.6, 1); put(f, 'desk', 62, -10, 1); put(f, 'deskChair', 58.6, -10, 1); put(f, 'cabinet', 37.4, -16, 1, { w: 6 });
    for (const x of [20, 44, 68]) for (const z of [-38, -52]) put(f, 'labBench', x, z, 0, { w: 14 });
    put(f, 'glassWall', 32, -45, 1, { w: 22 });
    put(f, 'glassWall', 56, -45, 1, { w: 22 });
    put(f, 'tank', 86, -60); put(f, 'tank', 86, -54);
    put(f, 'fridge', 87.4, -20, 3); put(f, 'fridge', 87.4, -16.5, 3); put(f, 'shelf', 78, -15.1, 0, { w: 12 });
    // Staff room, doctor's office, group therapy (NW).
    room(f, 'Staff Room', -36, 5, -5, 26, 'wood');
    room(f, "Doctor's Office", -68, 5, -36, 26, 'carpet');
    room(f, 'Group Therapy', -89, 26, -5, 65, 'carpet');
    room(f, 'Medicine Closet', -89, 10, -68, 26, 'tile');
    V(f, -36, 5, 26);
    H(f, 26, -89, -5, [-20, -78]);
    V(f, -68, 5, 26);
    H(f, 10, -89, -68);
    sign(f, 'STAFF ONLY', -20, 5.35, '-z', '#ffcf5a'); sign(f, 'DR. OFFICE', -52, 5.35, '-z', '#8fd0ff');
    put(f, 'sofa', -16, 24, 2); put(f, 'coffeeTable', -16, 19); put(f, 'counter', -34.4, 15, 1, { w: 12, d: 2.2 });
    put(f, 'coffeeMachine', -34.4, 12); put(f, 'table', -24, 12, 0, { w: 6, d: 3 }); put(f, 'fridge', -7, 24, 3);
    put(f, 'desk', -52, 20, 0); put(f, 'deskChair', -52, 22.6, 2); put(f, 'chair', -50, 16); put(f, 'chair', -54, 16);
    put(f, 'shelf', -66.6, 16, 1, { w: 10 }); put(f, 'plant', -38, 24);
    put(f, 'rug', -46, 46, 0, { w: 20, d: 20 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; put(f, 'chair', -46 + Math.cos(a) * 7, 46 + Math.sin(a) * 7, 0, { face: Math.atan2(-Math.cos(a), -Math.sin(a)) }); }
    put(f, 'sofa', -80, 50, 1); put(f, 'sofa', -80, 38, 1); put(f, 'shelf', -46, 63.6, 0, { w: 18 });
    put(f, 'whiteboard', -20, 64.6, 2); put(f, 'plant', -87, 63); put(f, 'plant', -7, 63);
    for (const z of [13.5, 19.5]) put(f, 'medShelf', -87.6, z, 1, { w: 5 });
    // Reception, camera room, conference, director's office, server room (NE).
    room(f, 'Reception', 5, 5, 36, 26, 'carpet');
    room(f, 'Camera Room', 36, 5, 68, 26, 'office');
    room(f, 'Conference', 5, 26, 40, 65, 'wood');
    room(f, "Director's Office", 40, 26, 89, 65, 'director');
    room(f, 'Server Room', 68, 10, 89, 26, 'concrete');
    V(f, 36, 5, 26);
    H(f, 26, 5, 89, [20, 78]);
    V(f, 40, 26, 65, [45]);
    V(f, 68, 5, 26);
    H(f, 10, 68, 89);
    sign(f, 'ADMINISTRATION', 20, 5.35, '-z', '#c5a3ff'); sign(f, 'SURVEILLANCE', 52, 5.35, '-z', '#5aa9ff');
    put(f, 'counter', 20, 18, 0, { w: 14, d: 2.4 }); put(f, 'deskChair', 20, 21, 2); put(f, 'monitor', 20, 18);
    put(f, 'bench', 8, 14, 1, { w: 8 }); put(f, 'plant', 34, 24);
    put(f, 'monitorDesk', 52, 24.4, 2, { w: 24 }); put(f, 'deskChair', 46, 21.5); put(f, 'deskChair', 58, 21.5);
    put(f, 'confTable', 22, 46, 1, { w: 22, d: 7 });
    for (const z of [38, 44, 50, 56]) { put(f, 'chair', 16.5, z, 1); put(f, 'chair', 27.5, z, 3); }
    put(f, 'whiteboard', 22, 64.6, 2);
    put(f, 'rug', 66, 48, 0, { w: 26, d: 18 });
    put(f, 'desk', 66, 56, 0, { w: 10, d: 3.6 }); put(f, 'deskChair', 66, 59.4, 2); put(f, 'monitor', 66, 56);
    put(f, 'sofa', 60, 38); put(f, 'sofa', 72, 38); put(f, 'coffeeTable', 66, 43);
    put(f, 'shelf', 87.6, 48, 1, { w: 16 }); put(f, 'plant', 43, 63); put(f, 'plant', 87, 28);
    for (const x of [72, 78, 84]) put(f, 'serverRack', x, 14);
    put(f, 'serverRack', 72, 22); put(f, 'serverRack', 78, 22);
  }

  // ---- Second floor: patient ward ---------------------------------------------------------
  {
    const f = 2;
    // 28 patient cells line the main corridor, seven per quadrant (9 wide, 12 deep). Every cell door
    // stands open, swung back into the cell.
    const cellCentres = [9.5, 18.5, 27.5, 36.5, 45.5, 54.5, 63.5];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      H(f, sz * 5, sx * 5, sx * 68, cellCentres.map(c => sx * c));
      H(f, sz * 17, sx * 5, sx * 68);
      for (const x of [14, 23, 32, 41, 50, 59]) V(f, sx * x, sz * 5, sz * 17);
      V(f, sx * 68, sz * 5, sz * 17);
      cellCentres.forEach((c, i) => {
        room(f, `Cell ${sx > 0 ? 'E' : 'W'}${sz > 0 ? 'N' : 'S'}${i + 1}`, sx * (c - 4.5), sz * 5, sx * (c + 4.5), sz * 17, 'cell');
        put(f, 'cellBed', sx * (c - 1), sz * 14.6, 1);
        put(f, 'toilet', sx * (c + 3), sz * 15.6);
        put(f, 'cellDoor', sx * (c + 1.85), sz * 6.9);
        sign(f, `CELL ${sz > 0 ? 'N' : 'S'}${sx > 0 ? 7 + i + 1 : 7 - i}`, sx * c, sz * 4.65, sz > 0 ? '-z' : '+z', '#70dbaf');
        put(f, 'sink', sx * (c - 3.4), sz * 8, sx > 0 ? 1 : 3);
      });
    }
    V(f, -5, 5, 65, [40]);
    V(f, 5, 5, 65, [30]);
    V(f, -5, -65, -5, [-35]);
    V(f, 5, -65, -5, [-35]);
    sign(f, 'WARD C · PATIENTS', -36, 17 + 0.35, '+z', '#70dbaf');
    sign(f, 'WARD C · PATIENTS', 36, -17 - 0.35, '-z', '#70dbaf');
    // Day room (NW).
    room(f, 'Day Room', -89, 17, -5, 65, 'wood');
    room(f, 'Day Room', -89, 10, -68, 17, 'wood');
    H(f, 10, -89, -68, [-78]);
    sign(f, 'DAY ROOM', -5.35, 40, '+x', '#ffcf5a');
    put(f, 'tv', -46, 64.6, 2); put(f, 'rug', -46, 52, 0, { w: 22, d: 12 });
    put(f, 'sofa', -46, 48); put(f, 'sofa', -55, 54, 1); put(f, 'sofa', -37, 54, 3);
    for (const [x, z] of [[-74, 30], [-74, 44], [-60, 30], [-20, 30], [-20, 44]]) {
      put(f, 'table', x, z, 0, { w: 6, d: 4 });
      put(f, 'chair', x - 1.6, z - 3); put(f, 'chair', x + 1.6, z - 3); put(f, 'chair', x - 1.6, z + 3, 2); put(f, 'chair', x + 1.6, z + 3, 2);
    }
    put(f, 'shelf', -87.6, 56, 1, { w: 14 }); put(f, 'pingPong', -36, 26); put(f, 'plant', -7, 63); put(f, 'plant', -87, 20);
    put(f, 'vending', -10, 19.4, 0);
    // Showers and isolation (NE).
    room(f, 'Showers', 5, 17, 40, 65, 'tile');
    room(f, 'Isolation', 40, 17, 89, 50, 'concrete');
    room(f, 'Isolation', 68, 10, 89, 17, 'concrete');
    V(f, 40, 17, 65);
    V(f, 68, 10, 17);
    H(f, 10, 68, 89, [78]);
    sign(f, 'SHOWERS', 5.35, 30, '-x', '#8fd0ff');
    sign(f, 'ISOLATION', 78, 10.35, '-z', '#ff7d6b');
    for (const x of [10, 17, 24, 31]) put(f, 'shower', x, 63.6, 2);
    for (const z of [26, 34, 42]) put(f, 'sink', 38.6, z, 3);
    put(f, 'bench', 22, 44, 0, { w: 14 });
    for (const x of [46, 54, 62]) put(f, 'toiletStall', x, 20.4);
    H(f, 50, 40, 89, [{ at: 51, closed: true }, { at: 65, closed: true }, 79]);
    V(f, 58, 50, 65); V(f, 72, 50, 65);
    room(f, 'Padded Cell', 40, 50, 58, 65, 'padded'); room(f, 'Padded Cell', 58, 50, 72, 65, 'padded'); room(f, 'Padded Cell', 72, 50, 89, 65, 'padded');
    put(f, 'restraintBed', 80, 60, 1);
    put(f, 'desk', 54, 36, 0, { w: 8, d: 3 }); put(f, 'deskChair', 54, 33.4); put(f, 'cabinet', 88.2, 30, 3, { w: 8 });
    put(f, 'wheelchair', 70, 34); put(f, 'wheelchair', 74, 34);
    // Dorm and nurse station (SW).
    room(f, 'Dormitory', -50, -65, -5, -17, 'lino');
    room(f, 'Nurse Station', -89, -65, -50, -17, 'lino');
    room(f, 'Nurse Station', -89, -17, -68, -14, 'lino');
    V(f, -50, -65, -17, [-40]);
    H(f, -14, -89, -68, [-78]);
    sign(f, 'DORMITORY', -5.35, -35, '+x', '#70dbaf');
    for (const x of [-44, -36, -28, -20, -12]) { put(f, 'bed', x, -60.6, 0, { old: true }); put(f, 'nightstand', x + 3.4, -63.4); }
    for (const x of [-44, -36, -20, -12]) put(f, 'bed', x, -22, 2, { old: true });
    put(f, 'lockers', -48.6, -28, 1, { w: 6 });
    put(f, 'counter', -66, -40, 1, { w: 18, d: 2.6 }); put(f, 'deskChair', -69.4, -40, 1); put(f, 'monitor', -66, -40, 3);
    put(f, 'medShelf', -87.6, -40, 1, { w: 14 }); put(f, 'medCart', -60, -30); put(f, 'wheelchair', -80, -22);
    put(f, 'cabinet', -70, -63.6, 0, { w: 10 });
    // Workshop and storage (SE).
    room(f, 'Workshop', 5, -65, 50, -17, 'concrete');
    room(f, 'Ward Storage', 50, -65, 89, -17, 'concrete');
    room(f, 'Ward Storage', 68, -17, 89, -14, 'concrete');
    V(f, 50, -65, -17, [-50]);
    V(f, 68, -17, -14);
    H(f, -14, 68, 89);
    sign(f, 'WORKSHOP', 5.35, -35, '-x', '#ffcf5a');
    for (const [x, z] of [[16, -28], [34, -28], [16, -50], [34, -50]]) put(f, 'workbench', x, z, 0, { w: 10 });
    put(f, 'shelf', 27, -63.6, 0, { w: 26 }); put(f, 'easel', 44, -22); put(f, 'easel', 10, -40);
    for (const z of [-60, -50, -40, -30, -22]) put(f, 'shelf', 87.6, z, 1, { w: 8 });
    put(f, 'crate', 60, -60); put(f, 'crate', 62.5, -57.5); put(f, 'crate', 60, -55); put(f, 'crate', 76, -36); put(f, 'crate', 66, -24);
  }

  for (const machine of VENDING) put(machine.floor, 'vending', machine.x, machine.z, machine.rot);

  // ---- Collision ----------------------------------------------------------------------------
  // Footprints (width along x, depth along z, before turning) of the furniture that blocks movement.
  const FOOTPRINTS = {
    bed: [2.6, 5.4], cellBed: [2.2, 4.6], examBed: [2.4, 5], restraintBed: [2.6, 5.2], operatingTable: [2.6, 5.6],
    counter: null, desk: [6, 3], table: null, diningTable: [9, 5.6], confTable: null, coffeeTable: [3.6, 2],
    sofa: [6, 2.4], bench: [null, 1.4], lockers: [null, 1.4], shelf: [null, 1.4], medShelf: [null, 1.4], cabinet: [null, 1.4],
    monitorDesk: [null, 2.4], labBench: [null, 3], workbench: [null, 3.4], glassWall: [null, 0.3], bars: [null, 0.4],
    vending: [2.4, 1.8], fridge: [2.6, 1.8], stove: [3.4, 2.4], washer: [2.6, 2.4], treadmill: [2.4, 5], benchPress: [2.4, 5],
    weightRack: [6, 1.4], rack: [null, 1.4], generator: [5, 4], serverRack: [3, 2.2], tank: [3, 3], pillar: [2.4, 2.4],
    shower: [5, 2.4], sink: [2.4, 1.4], toiletStall: [6, 6], fileCabinet: [3, 1.6], pingPong: [6, 3.4], crate: [2.4, 2.4],
    sterilizer: [3, 2], toilet: [1.2, 1.6], cellDoor: [0.2, 3.2], electricBox: [2.4, 0.8], whiteboard: null, tv: null,
    laundryCart: [2.4, 3], medCart: [2, 3], monitorCart: [1.8, 1.8], wheelchair: [2, 2.4], easel: [2, 2], plant: [1.2, 1.2],
  };
  function footprint(item) {
    const base = FOOTPRINTS[item.type];
    if (base === undefined && !(item.w && item.d)) return null;
    let w = item.w ?? base?.[0], d = item.d ?? base?.[1];
    if (base && base[0] === null) { w = item.w; d = item.d ?? base[1]; }
    if (!w || !d) return null;
    if (item.rot % 2) [w, d] = [d, w];
    return { minX: item.x - w / 2, maxX: item.x + w / 2, minZ: item.z - d / 2, maxZ: item.z + d / 2 };
  }
  // Rugs, mats, chairs and other low clutter can be walked over (or pushed past).
  const WALK_THROUGH = new Set(['rug', 'mat', 'chair', 'deskChair', 'monitor', 'trays', 'curtain', 'surgicalLamp', 'ivStand', 'coffeeMachine', 'nightstand', 'bucket', 'whiteboard', 'tv']);

  // The solid pieces of a wall: the wall minus its open doors.
  function wallPieces(w) {
    const alongX = w.z1 === w.z2;
    const start = alongX ? w.x1 : w.z1, end = alongX ? w.x2 : w.z2;
    const gaps = w.doors.filter(door => !door.closed).map(door => [door.at - DOOR_WIDTH / 2, door.at + DOOR_WIDTH / 2]).sort((a, b) => a[0] - b[0]);
    const pieces = [];
    let cursor = start;
    for (const [a, b] of gaps) { if (a > cursor) pieces.push([cursor, a]); cursor = Math.max(cursor, b); }
    if (end > cursor) pieces.push([cursor, end]);
    const half = w.thickness / 2;
    return pieces.map(([a, b]) => (alongX
      ? { minX: a, maxX: b, minZ: w.z1 - half, maxZ: w.z1 + half }
      : { minX: w.x1 - half, maxX: w.x1 + half, minZ: a, maxZ: b }));
  }
  const wallBoxes = walls.map(list => list.flatMap(wallPieces));

  // ---- Staircases ---------------------------------------------------------------------------
  // Each staircase climbs from its floor to the one above, straight along one axis: `dir` is the
  // way up in quarter turns (0 = +z, 1 = +x, 2 = -z, 3 = -x). In stair space s runs from the bottom
  // step (0) to the top (STAIR.run) and t across it. The floor above has a railed hole over it, open
  // at the top end where the steps arrive.
  const STAIR = { run: 12, width: 4, rail: 0.3, entry: 1.5, steps: 20 };
  const STAIRS_PER_FLOOR = 3;
  const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  // The server picks the seed when it starts and hands it to browsers via /layout-seed.js.
  const SEED = (Number(root.STAIR_SEED) >>> 0) || 1;
  function random(seed) {
    // mulberry32: small, fast and identical on the server and in every browser.
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function stairLocal(stair, x, z) {
    const [ax, az] = DIRS[stair.dir], dx = x - stair.x, dz = z - stair.z;
    return { s: dx * ax + dz * az + STAIR.run / 2, t: dx * az - dz * ax };
  }
  // Axis-aligned box covering s1..s2 along the stair and t1..t2 across it.
  function stairBox(stair, s1, s2, t1, t2) {
    const [ax, az] = DIRS[stair.dir];
    const xs = [], zs = [];
    for (const s of [s1, s2]) for (const t of [t1, t2]) {
      xs.push(stair.x + ax * (s - STAIR.run / 2) + az * t);
      zs.push(stair.z + az * (s - STAIR.run / 2) - ax * t);
    }
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  }
  const halfWide = STAIR.width / 2 + STAIR.rail;
  const stairBody = stair => stairBox(stair, 0, STAIR.run, -halfWide, halfWide);
  const onTread = l => l.s >= 0 && l.s <= STAIR.run && Math.abs(l.t) <= STAIR.width / 2;
  const rise = stair => FLOOR_Y[stair.floor + 1] - FLOOR_Y[stair.floor];

  const overlaps = (a, b, margin = 0) => a.maxX + margin > b.minX && a.minX - margin < b.maxX && a.maxZ + margin > b.minZ && a.minZ - margin < b.maxZ;
  const within = (box, r, margin) => box.minX >= r.x1 + margin && box.maxX <= r.x2 - margin && box.minZ >= r.z1 + margin && box.maxZ <= r.z2 - margin;
  const blockers = furniture.map((list, floor) => [
    ...wallBoxes[floor],
    ...list.filter(item => item.type !== 'rug' && item.type !== 'mat').map(footprint).filter(Boolean),
  ]);
  // Doorways, spawns and stations need room around them so a staircase never cuts anything off.
  const keepClear = FLOOR_Y.map((_, floor) => [
    ...walls[floor].flatMap(w => w.doors.map(door => (w.z1 === w.z2 ? { x: door.at, z: w.z1 } : { x: w.x1, z: door.at }))),
    ...Object.values(SPAWNS).filter(spawn => spawn.floor === floor),
    ...STATIONS.filter(spot => spot.floor === floor),
    ...VEHICLES.filter(spot => spot.floor === floor),
    // The main corridor carries on straight through both end halls: a staircase there would stand in
    // everyone's way, so it goes along a hall's side wall instead.
    ...[-1, 1].flatMap(side => [69, 73, 77, 81, 85].flatMap(x => [-3, 1].map(z => ({ x: side * x, z })))),
  ]);
  const roomOf = (floor, box) => rooms[floor].find(r => r.style !== 'corridor' && within(box, r, 0.4));

  // Walkability on a half-unit grid (with a comfortable 2-unit wide berth, not just a squeeze), so a
  // staircase is only accepted if it cuts nothing off: every
  // doorway, spawn and station that could be reached before must still be reachable from
  // the corridor crossing, and so must both ends of every staircase.
  const GRID = 0.5, GRID_X = Math.ceil(180 / GRID), GRID_Z = Math.ceil(132 / GRID), REACH_RADIUS = 1;
  function stampBox(grid, box, margin = REACH_RADIUS) {
    const i0 = Math.max(0, Math.floor((box.minX - margin + 90) / GRID)), i1 = Math.min(GRID_X - 1, Math.floor((box.maxX + margin + 90) / GRID));
    const j0 = Math.max(0, Math.floor((box.minZ - margin + 66) / GRID)), j1 = Math.min(GRID_Z - 1, Math.floor((box.maxZ + margin + 66) / GRID));
    for (let i = i0; i <= i1; i++) grid.fill(1, i * GRID_Z + j0, i * GRID_Z + j1 + 1);
  }
  const baseGrids = furniture.map((list, floor) => {
    const grid = new Uint8Array(GRID_X * GRID_Z);
    for (const box of wallBoxes[floor]) stampBox(grid, box);
    for (const item of list) if (!['rug', 'mat', 'chair', 'deskChair', 'monitor', 'trays', 'curtain', 'surgicalLamp', 'ivStand', 'coffeeMachine', 'nightstand', 'bucket', 'whiteboard', 'tv'].includes(item.type)) {
      const box = footprint(item); if (box) stampBox(grid, box);
    }
    return grid;
  });
  // On its own floor a staircase blocks everything but its foot; on the floor above, its hole does.
  function stampStair(grid, floor, stair) {
    const wide = STAIR.width / 2 + STAIR.rail;
    if (stair.floor === floor) stampBox(grid, stairBox(stair, 0.5, STAIR.run + 0.3, -wide, wide));
    if (stair.floor + 1 === floor) stampBox(grid, stairBox(stair, -STAIR.rail - 0.3, STAIR.run - STAIR.entry, -wide, wide));
  }
  function reachable(floor, stairs) {
    const grid = baseGrids[floor].slice();
    for (const stair of stairs) stampStair(grid, floor, stair);
    const seen = new Uint8Array(GRID_X * GRID_Z), stack = [];
    const start = Math.floor(90 / GRID) * GRID_Z + Math.floor(66 / GRID);
    if (!grid[start]) { seen[start] = 1; stack.push(start); }
    while (stack.length) {
      const k = stack.pop(), i = Math.floor(k / GRID_Z), j = k % GRID_Z;
      for (const kk of [i > 0 ? k - GRID_Z : -1, i < GRID_X - 1 ? k + GRID_Z : -1, j > 0 ? k - 1 : -1, j < GRID_Z - 1 ? k + 1 : -1]) {
        if (kk >= 0 && !grid[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
      }
    }
    // A spot counts as reachable when you can get within 1.5 of it.
    return (x, z) => {
      for (let dx = -1.5; dx <= 1.5; dx += GRID) for (let dz = -1.5; dz <= 1.5; dz += GRID) {
        const i = Math.floor((x + dx + 90) / GRID), j = Math.floor((z + dz + 66) / GRID);
        if (i >= 0 && j >= 0 && i < GRID_X && j < GRID_Z && seen[i * GRID_Z + j]) return true;
      }
      return false;
    };
  }
  const centre = box => ({ x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 });
  const stairFoot = stair => centre(stairBox(stair, -2, -1, -0.5, 0.5));
  const stairTop = stair => centre(stairBox(stair, STAIR.run + 1, STAIR.run + 2, -0.5, 0.5));
  const mustReach = FLOOR_Y.map((_, floor) => [
    ...walls[floor].flatMap(w => w.doors.filter(door => !door.closed).map(door => (w.z1 === w.z2 ? { x: door.at, z: w.z1 } : { x: w.x1, z: door.at }))),
    ...Object.values(SPAWNS).filter(spot => spot.floor === floor),
    ...STATIONS.filter(spot => spot.floor === floor),
  ]);
  // Targets on `floor` that are reachable with `stairs` in place, including the stairs' own ends.
  function cutsNothingOff(floor, stairs, candidate) {
    const before = reachable(floor, stairs), after = reachable(floor, [...stairs, candidate]);
    const ends = [...stairs, candidate].flatMap(stair => [
      ...(stair.floor === floor ? [stairFoot(stair)] : []), ...(stair.floor + 1 === floor ? [stairTop(stair)] : []),
    ]);
    return mustReach[floor].every(p => !before(p.x, p.z) || after(p.x, p.z)) && ends.every(p => after(p.x, p.z));
  }
  const STAIRS = [];
  {
    const rand = random(SEED);
    const taken = FLOOR_Y.map(() => []); // boxes already claimed by stairs, holes and their landings
    const fits = (floor, box, extra = []) => !blockers[floor].some(b => overlaps(box, b, 0.3))
      && !taken[floor].some(b => overlaps(box, b, 1))
      && !keepClear[floor].some(p => p.x > box.minX - 3 && p.x < box.maxX + 3 && p.z > box.minZ - 3 && p.z < box.maxZ + 3)
      && extra.every(Boolean);
    for (let floor = 0; floor < FLOOR_Y.length - 1; floor++) {
      const candidates = rooms[floor].filter(r => !['corridor', 'cell', 'padded'].includes(r.style));
      // Shuffle the rooms, then try a handful of random spots and directions in each.
      for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
      let placed = 0;
      for (const r of candidates) {
        if (placed >= STAIRS_PER_FLOOR) break;
        for (let attempt = 0; attempt < 40; attempt++) {
          const stair = {
            floor, dir: Math.floor(rand() * 4),
            x: Math.round((r.x1 + rand() * (r.x2 - r.x1)) * 2) / 2,
            z: Math.round((r.z1 + rand() * (r.z2 - r.z1)) * 2) / 2,
          };
          const body = stairBody(stair);
          const foot = stairBox(stair, -3.5, 0, -STAIR.width / 2, STAIR.width / 2);
          const landing = stairBox(stair, STAIR.run, STAIR.run + 3.5, -STAIR.width / 2, STAIR.width / 2);
          const bottomRoom = roomOf(floor, body), topRoom = roomOf(floor + 1, body);
          if (bottomRoom !== r || !topRoom || !roomOf(floor, foot) || !roomOf(floor + 1, landing)) continue;
          if (!fits(floor, body) || !fits(floor, foot) || !fits(floor + 1, body) || !fits(floor + 1, landing)) continue;
          if (!cutsNothingOff(floor, STAIRS, stair) || !cutsNothingOff(floor + 1, STAIRS, stair)) continue;
          stair.from = bottomRoom.name; stair.to = topRoom.name;
          STAIRS.push(stair);
          taken[floor].push(body, foot);
          taken[floor + 1].push(body, landing);
          placed++;
          break;
        }
      }
      // Should the dice ever leave a floor without a way up, fall back to the halls at both ends.
      if (!placed) {
        for (const side of [-1, 1]) {
          const stair = { floor, dir: 0, x: side * 78, z: -1.5, from: side > 0 ? 'East Hall' : 'West Hall', to: side > 0 ? 'East Hall' : 'West Hall' };
          STAIRS.push(stair); taken[floor].push(stairBody(stair)); taken[floor + 1].push(stairBody(stair));
        }
      }
    }
  }
  // Side rails on the steps, and a railing around three sides of the hole on the floor above.
  const stairRails = FLOOR_Y.map(() => []);
  for (const stair of STAIRS) {
    const w = STAIR.width / 2, r = STAIR.rail;
    const sides = [stairBox(stair, 0, STAIR.run, w, w + r), stairBox(stair, 0, STAIR.run, -w - r, -w)];
    stairRails[stair.floor].push(...sides);
    stairRails[stair.floor + 1].push(...sides, stairBox(stair, -r, 0, -w - r, w + r));
  }

  // Where moving from (x0, z0) to (x1, z1) on `floor` takes you: { floor, height } with the height of
  // the steps underfoot, or null when the way is barred. Steps are entered at the bottom from below
  // and at the top from the floor above; walking off the top end arrives on the next floor.
  function stairMove(floor, x0, z0, x1, z1) {
    for (const stair of STAIRS) {
      if (stair.floor === floor) {
        const a = stairLocal(stair, x0, z0), b = stairLocal(stair, x1, z1);
        const was = onTread(a), now = onTread(b);
        if (was && !now) {
          if (b.s > STAIR.run) return { floor: floor + 1, height: 0 };
          if (b.s < 0) return { floor, height: 0 };
          return null;
        }
        if (now) return !was && b.s > STAIR.entry ? null : { floor, height: (b.s / STAIR.run) * rise(stair) };
      } else if (stair.floor + 1 === floor) {
        const b = stairLocal(stair, x1, z1);
        if (onTread(b)) return b.s < STAIR.run - STAIR.entry ? null : { floor: stair.floor, height: (b.s / STAIR.run) * rise(stair) };
      }
    }
    return { floor, height: 0 };
  }
  // Height of the steps under (x, z) on `floor`, 0 when not on a staircase.
  function stairHeight(floor, x, z) {
    for (const stair of STAIRS) {
      if (stair.floor !== floor) continue;
      const l = stairLocal(stair, x, z);
      if (onTread(l)) return (l.s / STAIR.run) * rise(stair);
    }
    return 0;
  }
  // The floors a player at (x, z) on `floor` can look into through a nearby staircase.
  function stairNeighbours(floor, x, z, margin = 8) {
    const found = [];
    for (const stair of STAIRS) {
      if (stair.floor !== floor && stair.floor + 1 !== floor) continue;
      const body = stairBody(stair);
      if (x > body.minX - margin && x < body.maxX + margin && z > body.minZ - margin && z < body.maxZ + margin) {
        found.push(stair.floor === floor ? floor + 1 : stair.floor);
      }
    }
    return found;
  }

  // ---- Security doors ----------------------------------------------------------------------
  // Doorways into staff rooms get a door that only staff (and patients with a stolen keycard) can
  // pass. A room that holds a staircase stays open, so the random stairs never get locked away.
  const SECURE_ROOMS = new Set([
    'Security Office', 'Holding', 'Equipment', 'Staff Lockers', 'Pharmacy', 'Research Lab', 'Cold Storage',
    'Operating Room', 'Staff Room', 'Camera Room', "Director's Office", 'Server Room',
  ]);
  const roomAt = (floor, x, z) => rooms[floor].find(r => r.style !== 'corridor' && x > r.x1 && x < r.x2 && z > r.z1 && z < r.z2);
  const hasStairs = (floor, name) => STAIRS.some(s => (s.floor === floor && s.from === name) || (s.floor + 1 === floor && s.to === name));
  const SECURE_DOORS = [];
  walls.forEach((list, floor) => list.forEach(w => w.doors.forEach(door => {
    if (door.closed) return;
    const alongX = w.z1 === w.z2;
    const x = alongX ? door.at : w.x1, z = alongX ? w.z1 : door.at;
    const sides = alongX ? [[x, z - 1.5], [x, z + 1.5]] : [[x - 1.5, z], [x + 1.5, z]];
    const names = sides.map(([sx, sz]) => roomAt(floor, sx, sz)?.name);
    const room = names.find(name => SECURE_ROOMS.has(name));
    if (!room || names.some(name => name && hasStairs(floor, name))) return;
    const half = w.thickness / 2, reach = DOOR_WIDTH / 2;
    const box = alongX ? { minX: x - reach, maxX: x + reach, minZ: z - half, maxZ: z + half } : { minX: x - half, maxX: x + half, minZ: z - reach, maxZ: z + reach };
    SECURE_DOORS.push({ id: `door${SECURE_DOORS.length}`, floor, x, z, alongX, room, box });
  })));
  // Does the segment from (x1, z1) to (x2, z2) touch `box` grown by `margin`?
  function segmentHitsBox(box, x1, z1, x2, z2, margin = 0) {
    const dx = x2 - x1, dz = z2 - z1;
    let t0 = 0, t1 = 1;
    for (const [p, d, min, max] of [[x1, dx, box.minX - margin, box.maxX + margin], [z1, dz, box.minZ - margin, box.maxZ + margin]]) {
      if (Math.abs(d) < 1e-9) { if (p <= min || p >= max) return false; continue; }
      let a = (min - p) / d, b = (max - p) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 >= t1) return false;
    }
    return true;
  }

  const solids = furniture.map((list, floor) => [
    ...wallBoxes[floor].map(box => ({ ...box, tall: true })),
    ...list.filter(item => !WALK_THROUGH.has(item.type)).map(footprint).filter(Boolean),
    ...stairRails[floor],
  ]);

  // Does the segment from (x1, z1) to (x2, z2) pass through a wall? Used by the server for line of
  // sight and to stop players walking through walls.
  function wallBetween(floor, x1, z1, x2, z2) {
    const boxes = wallBoxes[floor]; if (!boxes) return false;
    const dx = x2 - x1, dz = z2 - z1;
    for (const box of boxes) {
      let t0 = 0, t1 = 1, hit = true;
      for (const [p, d, min, max] of [[x1, dx, box.minX, box.maxX], [z1, dz, box.minZ, box.maxZ]]) {
        if (Math.abs(d) < 1e-9) { if (p <= min || p >= max) { hit = false; break; } continue; }
        let a = (min - p) / d, b = (max - p) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 >= t1) { hit = false; break; }
      }
      if (hit) return true;
    }
    return false;
  }

  const LAYOUT = {
    FLOOR_Y, FLOOR_NAMES, WALL_HEIGHT, WALL_THICKNESS, DOOR_WIDTH, DOOR_HEIGHT, BOUNDS, SEED, STAIR, STAIRS,
    stairBox, stairBody, stairLocal, stairMove, stairHeight, stairNeighbours,
    SPAWNS, LOOT, CAMERAS, STATIONS, STATION_RANGE, VEHICLE_TYPES, VEHICLES, SECURE_DOORS, segmentHitsBox, walls, rooms, furniture, signs, solids, wallBoxes, wallPieces, footprint, wallBetween,
  };
  if (typeof module === 'object' && module.exports) module.exports = LAYOUT;
  else root.LAYOUT = LAYOUT;
})(typeof globalThis !== 'undefined' ? globalThis : this);
