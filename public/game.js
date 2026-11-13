const TEAM_PRESETS = [
  { id: 1, name: 'Team 1', colors: ['#17314f', '#0f1f2d', '#68d7ff'] },
  { id: 2, name: 'Team 2', colors: ['#472a4a', '#1a1b2d', '#ff9bb5'] },
  { id: 3, name: 'Team 3', colors: ['#3e1d11', '#1a1a18', '#ffb55a'] },
  { id: 4, name: 'Team 4', colors: ['#2f2a39', '#1b1d20', '#9aceff'] }
];

const CAMERA_PRESETS = [
  { id: 'overview', label: 'Overview', yaw: 0.5, pitch: 0.55, x: 0, z: 0, floor: 0 },
  { id: 'research', label: 'Research', yaw: -0.8, pitch: 0.5, x: -42, z: -30, floor: 1 },
  { id: 'medical', label: 'Medical', yaw: 1.2, pitch: 0.45, x: 38, z: 30, floor: 2 },
  { id: 'ward', label: 'Ward', yaw: 2.5, pitch: 0.42, x: -18, z: 56, floor: 3 }
];

const state = {
  role: null,
  id: null,
  x: 0,
  z: 0,
  floor: 0,
  yaw: 0,
  pitch: 0.34,
  actor: null,
  health: 100,
  team: 1
};

function renderTeamPicker() {
  const picker = document.getElementById('teamPicker');
  if (!picker) return;
  picker.innerHTML = '<strong>TEAM SELECT</strong><div class="team-card-grid"></div>';
  const grid = picker.querySelector('.team-card-grid');
  TEAM_PRESETS.forEach((team) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'team-card' + (state.team === team.id ? ' selected' : '');
    button.dataset.team = String(team.id);
    button.innerHTML = `
      <span class="team-card-art" style="background:linear-gradient(135deg, ${team.colors[0]}, ${team.colors[1]} 54%, ${team.colors[2]});"></span>
      <span class="team-card-label">${team.name}</span>
    `;
    button.addEventListener('click', () => {
      state.team = team.id;
      renderTeamPicker();
    });
    grid.appendChild(button);
  });
}

function renderCameraPresets() {
  const host = document.getElementById('cameraPresets');
  if (!host) return;
  host.innerHTML = '';
  CAMERA_PRESETS.forEach((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'camera-preset';
    button.textContent = preset.label;
    button.addEventListener('click', () => {
      const active = document.querySelectorAll('.camera-preset');
      active.forEach((item) => item.classList.toggle('active', item === button));
      state.floor = preset.floor;
      state.x = preset.x;
      state.z = preset.z;
      state.yaw = preset.yaw;
      state.pitch = preset.pitch;
      setFloor(preset.floor);
      if (state.actor) {
        state.actor.position.set(state.x, FLOOR_Y[state.floor], state.z);
      }
      updateCamera(1);
    });
    host.appendChild(button);
  });
}

function toggleTabletPanel(show = false) {
  const panel = document.getElementById('tabletPanel');
  if (!panel) return;
  panel.classList.toggle('hidden', !show);
}

const originalState = { role: null, id: null, x: 0, z: 0, floor: 0, yaw: 0, pitch: 0.34, actor: null, health: 100 };
Object.assign(state, originalState);

renderTeamPicker();
renderCameraPresets();

document.addEventListener('DOMContentLoaded', () => {
  toggleTabletPanel(true);
});

window.addEventListener('load', () => {
  toggleTabletPanel(true);
});
