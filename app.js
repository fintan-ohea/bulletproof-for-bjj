const PROGRAM_FILES = [
  'fortify-1-workout-1.json',
  'fortify-1-workout-2.json',
  'fortify-2-workout-1.json',
  'fortify-2-workout-2.json',
  'density-1-workout-1.json',
  'density-1-workout-2.json',
  'density-2-workout-1.json',
  'density-2-workout-2.json',
  'diamond-1-workout-1.json',
  'diamond-1-workout-2.json',
  'diamond-2-workout-1.json',
  'diamond-2-workout-2.json'
];

const PRIMARY_PATTERNS = [
  { sets: 3, reps: 3 },
  { sets: 3, reps: 5 },
  { sets: 4, reps: 3 },
  { sets: 4, reps: 5 },
  { sets: 5, reps: 3 },
  { sets: 5, reps: 5 }
];

const STORAGE_KEY = 'sandbag-workout-app-state';

const state = {
  workouts: [],
  currentIndex: 0,
  completed: {},
  workoutRoundCounts: {},
  history: [],
  primaryTimer: {
    intervalId: null,
    duration: 0,
    remaining: 0,
    lastBeepSecond: null,
    element: null
  }
};

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    if (parsed.currentIndex !== undefined) {
      state.currentIndex = parsed.currentIndex;
    }
    if (parsed.completed) {
      state.completed = parsed.completed;
    }
    if (parsed.workoutRoundCounts) {
      state.workoutRoundCounts = parsed.workoutRoundCounts;
    }
    if (parsed.history) {
      state.history = parsed.history;
    }
  } catch (error) {
    console.warn('Could not restore progress from local storage.', error);
  }
}

function persistState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      currentIndex: state.currentIndex,
      completed: state.completed,
      workoutRoundCounts: state.workoutRoundCounts,
      history: state.history
    })
  );
}

function getWorkoutKey(workout) {
  return workout.fileName;
}

function getPrimaryPatternForWorkout(workout) {
  const count = Number(state.workoutRoundCounts[workout.fileName] || 0);
  const index = Math.min(count, PRIMARY_PATTERNS.length - 1);
  return PRIMARY_PATTERNS[index] || PRIMARY_PATTERNS[0];
}

const VIDEO_BASE_URL = 'https://d3742cffkcu4i8.cloudfront.net/';

function parseSetLabel(sets) {
  if (!Array.isArray(sets) || sets.length === 0) {
    return 'Working reps';
  }

  const labels = sets
    .map((set) => (set.title || '').trim())
    .filter(Boolean)
    .slice(0, 4);

  return labels.length ? labels.join(' • ') : 'Working reps';
}

function normalizeVideoUrl(mediaUrl) {
  if (!mediaUrl) {
    return '';
  }

  const trimmed = String(mediaUrl).trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return new URL(trimmed, VIDEO_BASE_URL).toString();
}

function parseBlockRestLabel(blockTitle = '') {
  const match = blockTitle.match(/rest\s+(\d+)\s*sec(?:\s+after\s+exercise\s*(\d+))?/i);
  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  const afterExercise = match[2] ? Number(match[2]) : null;

  return {
    seconds,
    label: afterExercise ? `Rest ${seconds} sec after exercise ${afterExercise}` : `Rest ${seconds} sec`
  };
}

function getExerciseRestLabel(block, exercise) {
  const progression = exercise.allProgression || exercise.allProgressions?.[0] || {};
  const progressionRest = progression.rest_time_after_exercise ?? progression.restTimeAfterExercise ?? progression.rest_time ?? progression.restTime ?? progression.rest_after_exercise;
  const fromProgression = Number(progressionRest);

  if (Number.isFinite(fromProgression) && fromProgression > 0) {
    return `Rest ${fromProgression} sec`;
  }

  const blockRest = parseBlockRestLabel(block.title || '');
  if (blockRest) {
    return blockRest.label;
  }

  return '';
}

function flattenExercises(workoutData) {
  const exercises = [];

  workoutData.forEach((block) => {
    const allExercise = block.allExercise || [];
    allExercise.forEach((exercise) => {
      const progression = exercise.allProgression || exercise.allProgressions?.[0] || {};
      const restLabel = getExerciseRestLabel(block, exercise);
      const demoVideo = progression.demoVideoData || exercise.demoVideoData || {};
      const instructVideo = progression.instructVideoData || exercise.instructVideoData || {};

      exercises.push({
        id: exercise._id || `${block._id}-${exercise.title}`,
        title: exercise.title || 'Exercise',
        phase: block.session_stage_detail?.title || 'Workout',
        notes: progression.note || '',
        setLabel: parseSetLabel(progression.sets || []),
        sets: progression.sets || [],
        restLabel,
        demoMediaUrl: normalizeVideoUrl(demoVideo.media || ''),
        instructMediaUrl: normalizeVideoUrl(instructVideo.media || '')
      });
    });
  });

  return exercises;
}

async function loadWorkoutData() {
  const allFiles = await Promise.all(
    PROGRAM_FILES.map(async (fileName) => {
      const response = await fetch(fileName);
      if (!response.ok) {
        throw new Error(`Failed to load ${fileName}`);
      }
      return response.json();
    })
  );

  state.workouts = allFiles.map((entry, index) => {
    const payload = entry.data || entry;
    const cycleTitle = payload.cycleData?.title || 'Program workout';
    const workoutTitle = payload.title || `Workout ${index + 1}`;

    return {
      fileName: PROGRAM_FILES[index],
      cycleTitle,
      workoutTitle,
      repGoal: getPrimaryPatternForWorkout({ fileName: PROGRAM_FILES[index] }),
      exercises: flattenExercises(payload.workoutData || []),
      id: PROGRAM_FILES[index]
    };
  });

  if (state.currentIndex >= state.workouts.length) {
    state.currentIndex = state.workouts.length - 1;
  }

  render();
}

function renderProgramRail() {
  const programRail = document.getElementById('program-rail');
  programRail.innerHTML = '';

  state.workouts.forEach((workout, index) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `stage-pill ${index === state.currentIndex ? 'active' : ''}`;
    pill.innerHTML = `
      <strong>${workout.cycleTitle}</strong>
      <small>${workout.workoutTitle}</small>
    `;
    pill.addEventListener('click', () => {
      state.currentIndex = index;
      persistState();
      render();
    });
    programRail.appendChild(pill);
  });
}

function renderWorkoutSelectorDropdown() {
  const select = document.getElementById('workout-select');
  if (!select) {
    return;
  }

  select.innerHTML = state.workouts
    .map(
      (workout, index) => `
        <option value="${index}" ${index === state.currentIndex ? 'selected' : ''}>
          ${workout.cycleTitle} ${workout.workoutTitle}
        </option>
      `
    )
    .join('');
}

function getExerciseSetId(exercise, index) {
  return exercise.sets?.[index]?._id || `${exercise.id}-set-${index + 1}`;
}

function getExerciseSetsForDisplay(exercise, workout) {
  const phaseName = (exercise.phase || '').toLowerCase();
  const primaryPattern = getPrimaryPatternForWorkout(workout);

  if (phaseName === 'primary') {
    return Array.from({ length: primaryPattern.sets }, (_, index) => ({
      title: String(primaryPattern.reps),
      _id: `${exercise.id}-set-${index + 1}`
    }));
  }

  return Array.isArray(exercise.sets) && exercise.sets.length > 0 ? exercise.sets : [{ title: '1', _id: `${exercise.id}-set-1` }];
}

function updateSubmitAvailability() {
  const submitButton = document.getElementById('complete-workout');
  const allSetCheckboxes = document.querySelectorAll('input[type="checkbox"]');
  submitButton.disabled = allSetCheckboxes.length === 0 || [...allSetCheckboxes].some((box) => !box.checked);
}

function openVideoModal(videoUrl, label) {
  const existingModal = document.getElementById('video-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement('div');
  modal.id = 'video-modal';
  modal.className = 'video-modal';
  modal.innerHTML = `
    <div class="video-modal-backdrop" data-close-modal="true"></div>
    <div class="video-modal-dialog" role="dialog" aria-modal="true" aria-label="${label}">
      <div class="video-modal-header">
        <h3>${label}</h3>
        <button type="button" class="video-close-btn" aria-label="Close video">✕</button>
      </div>
      <video class="video-player" controls playsinline autoplay>
        <source src="${videoUrl}" type="video/mp4" />
        Your browser does not support HTML5 video.
      </video>
    </div>
  `;

  const closeButton = modal.querySelector('.video-close-btn');
  const backdrop = modal.querySelector('[data-close-modal="true"]');

  closeButton.addEventListener('click', () => modal.remove());
  backdrop.addEventListener('click', () => modal.remove());
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      modal.remove();
    }
  });
  modal.tabIndex = -1;
  modal.focus();
  document.body.appendChild(modal);
}

function formatTimerDisplay(secondsLeft) {
  if (secondsLeft <= 0) {
    return 'Rest complete';
  }

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  if (minutes > 0) {
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  return `${seconds}s`;
}

function beepTimerTone() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = 'square';
  oscillator.frequency.value = 880;
  gainNode.gain.value = 0.04;

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.08);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.1);
}

function stopPrimaryTimer() {
  if (state.primaryTimer.intervalId) {
    clearInterval(state.primaryTimer.intervalId);
    state.primaryTimer.intervalId = null;
  }
  state.primaryTimer.lastBeepSecond = null;
}

function startPrimaryTimer(seconds) {
  stopPrimaryTimer();
  state.primaryTimer.duration = seconds;
  state.primaryTimer.remaining = seconds;

  const timerElement = document.getElementById('primary-rest-timer');
  if (!timerElement) {
    return;
  }

  const startTime = Date.now();
  const updateTimer = () => {
    const elapsedMs = Date.now() - startTime;
    const remainingSeconds = Math.max(0, Math.ceil((seconds * 1000 - elapsedMs) / 1000));
    state.primaryTimer.remaining = remainingSeconds;
    timerElement.textContent = formatTimerDisplay(remainingSeconds);

    if (remainingSeconds <= 5 && remainingSeconds > 0) {
      if (state.primaryTimer.lastBeepSecond !== remainingSeconds) {
        beepTimerTone();
        state.primaryTimer.lastBeepSecond = remainingSeconds;
      }
    } else if (remainingSeconds > 5) {
      state.primaryTimer.lastBeepSecond = null;
    }

    if (remainingSeconds <= 0) {
      stopPrimaryTimer();
      timerElement.textContent = 'Rest complete';
    }
  };

  updateTimer();
  state.primaryTimer.intervalId = setInterval(updateTimer, 250);
}

function renderExerciseList() {
  const exerciseList = document.getElementById('exercise-list');
  const workout = state.workouts[state.currentIndex];

  if (!workout) {
    exerciseList.innerHTML = '<p>No workout loaded.</p>';
    return;
  }

  if (workout.exercises.length === 0) {
    exerciseList.innerHTML = '<p>No exercise details found for this workout.</p>';
    return;
  }

  exerciseList.innerHTML = '';

  const groupedExercises = {
    Warmup: [],
    Primary: [],
    Accessory: []
  };

  workout.exercises.forEach((exercise) => {
    const phaseName = (exercise.phase || '').toLowerCase();
    if (phaseName === 'warmup') {
      groupedExercises.Warmup.push(exercise);
    } else if (phaseName === 'primary') {
      groupedExercises.Primary.push(exercise);
    } else {
      groupedExercises.Accessory.push(exercise);
    }
  });

  Object.entries(groupedExercises).forEach(([phaseTitle, exercises]) => {
    if (!exercises.length) {
      return;
    }

    const section = document.createElement('section');
    section.className = 'phase-section';

    const heading = document.createElement('h2');
    heading.className = 'phase-title';
    heading.textContent = phaseTitle;
    section.appendChild(heading);

    const exerciseGroup = document.createElement('div');
    exerciseGroup.className = 'exercise-group';

    exercises.forEach((exercise) => {
      const container = document.createElement('div');
      container.className = 'exercise-item';

      const exerciseSets = getExerciseSetsForDisplay(exercise, workout);

      const setRows = exerciseSets
        .map((set, index) => {
          const setId = getExerciseSetId(exercise, index);
          const key = getWorkoutKey(workout);
          const isComplete = Boolean(state.completed[key]?.[exercise.id]?.[setId]);
          const setLabel = set.title ? `Set ${index + 1} • ${set.title}` : `Set ${index + 1}`;

          return `
            <label class="set-row">
              <input
                type="checkbox"
                data-workout-id="${workout.id}"
                data-exercise-id="${exercise.id}"
                data-set-id="${setId}"
                ${isComplete ? 'checked' : ''}
              />
              <span>${setLabel}</span>
            </label>
          `;
        })
        .join('');

      const mediaButtons = [];
      if (exercise.demoMediaUrl) {
        mediaButtons.push(`
          <button
            type="button"
            class="video-btn demo-btn"
            data-video-url="${exercise.demoMediaUrl}"
            data-video-label="${exercise.title} demo video"
            aria-label="Play demo video for ${exercise.title}"
            title="Demo video"
          >▶</button>
        `);
      }
      if (exercise.instructMediaUrl) {
        mediaButtons.push(`
          <button
            type="button"
            class="video-btn instruct-btn"
            data-video-url="${exercise.instructMediaUrl}"
            data-video-label="${exercise.title} instruction video"
            aria-label="Play instruction video for ${exercise.title}"
            title="Instruction video"
          >▣</button>
        `);
      }

      container.innerHTML = `
        <div class="exercise-info">
          <div class="exercise-heading-row">
            <h3 class="exercise-title">${exercise.title}</h3>
            ${mediaButtons.length ? `<div class="exercise-video-actions">${mediaButtons.join('')}</div>` : ''}
          </div>
          <div class="exercise-meta">
            <span>${exercise.phase}</span>
            <span>•</span>
            <span>${exercise.setLabel}</span>
            ${exercise.restLabel ? `<span>•</span><span>${exercise.restLabel}</span>` : ''}
          </div>
          ${exercise.notes ? `<div class="exercise-notes">${exercise.notes}</div>` : ''}
          <div class="set-list">${setRows}</div>
          <button type="button" class="mark-all-btn">Mark all sets complete</button>
        </div>
      `;

      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      const markAllButton = container.querySelector('.mark-all-btn');
      const mediaActionButtons = container.querySelectorAll('.video-btn');

      mediaActionButtons.forEach((button) => {
        button.addEventListener('click', () => {
          openVideoModal(button.dataset.videoUrl, button.dataset.videoLabel);
        });
      });

      checkboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          const key = getWorkoutKey(workout);
          if (!state.completed[key]) {
            state.completed[key] = {};
          }
          if (!state.completed[key][exercise.id]) {
            state.completed[key][exercise.id] = {};
          }
          state.completed[key][exercise.id][checkbox.dataset.setId] = checkbox.checked;
          persistState();
          updateSubmitAvailability();
        });
      });

      markAllButton.addEventListener('click', () => {
        checkboxes.forEach((checkbox) => {
          if (!checkbox.checked) {
            checkbox.checked = true;
            const key = getWorkoutKey(workout);
            if (!state.completed[key]) {
              state.completed[key] = {};
            }
            if (!state.completed[key][exercise.id]) {
              state.completed[key][exercise.id] = {};
            }
            state.completed[key][exercise.id][checkbox.dataset.setId] = true;
          }
        });
        persistState();
        updateSubmitAvailability();
      });

      exerciseGroup.appendChild(container);
    });

    section.appendChild(exerciseGroup);

    if (phaseTitle === 'Primary') {
      const timerControls = document.createElement('div');
      timerControls.className = 'primary-rest-timer-section';
      timerControls.innerHTML = `
        <div class="primary-rest-timer-header">
          <span>Rest timer</span>
          <strong id="primary-rest-timer">Ready</strong>
        </div>
        <div class="primary-rest-timer-actions">
          <button type="button" class="rest-timer-btn" data-seconds="60">60 sec</button>
          <button type="button" class="rest-timer-btn" data-seconds="90">90 sec</button>
        </div>
      `;
      const timerButtons = timerControls.querySelectorAll('.rest-timer-btn');
      timerButtons.forEach((button) => {
        button.addEventListener('click', () => {
          startPrimaryTimer(Number(button.dataset.seconds));
        });
      });
      section.appendChild(timerControls);
    }

    exerciseList.appendChild(section);
  });

  updateSubmitAvailability();
}

function renderStatusBanner() {
  const banner = document.getElementById('program-status');
  const currentWorkout = state.workouts[state.currentIndex];

  if (!banner || !currentWorkout) {
    return;
  }

  const currentPattern = getPrimaryPatternForWorkout(currentWorkout);
  banner.textContent = `Current target: ${currentPattern.sets}x${currentPattern.reps} for primary lifts. Increase sandbag after completing the 5x5 cycle.`;
}

function renderHistoryList() {
  const historyList = document.getElementById('history-list');
  if (!historyList) {
    return;
  }

  const recent = state.history.slice(-6).reverse();
  const historyItems = recent.length
    ? recent
        .map(
          (entry) => `
            <div class="history-item">
              <span>${entry.title}</span>
              <small>${entry.pattern} • ${new Date(entry.date).toLocaleDateString()}</small>
            </div>
          `
        )
        .join('')
    : '<div class="history-item"><span>No completed workouts yet</span><small>Start your first round</small></div>';

  historyList.innerHTML = `
    <details class="history-panel" ${recent.length ? 'open' : ''}>
      <summary class="history-panel-summary">
        <span>Workout history (${recent.length})</span>
      </summary>
      <div class="history-panel-content">
        ${historyItems}
      </div>
    </details>
  `;
}

function renderCurrentWorkout() {
  const currentWorkout = state.workouts[state.currentIndex];
  if (!currentWorkout) {
    return;
  }

  const programLabel = document.getElementById('program-label');
  const workoutTitle = document.getElementById('workout-title');
  const repSummary = document.getElementById('rep-summary');

  const activePattern = getPrimaryPatternForWorkout(currentWorkout);

  programLabel.textContent = currentWorkout.cycleTitle;
  workoutTitle.textContent = currentWorkout.workoutTitle;
  repSummary.textContent = `Working reps: ${activePattern.sets} sets x ${activePattern.reps} reps per set`;
}

function render() {
  renderProgramRail();
  renderWorkoutSelectorDropdown();
  renderCurrentWorkout();
  renderStatusBanner();
  renderHistoryList();
  renderExerciseList();
}

function getNextWorkoutIndex() {
  const nextIndex = state.currentIndex + 1;
  return nextIndex < state.workouts.length ? nextIndex : state.currentIndex;
}

function moveToNextWorkout() {
  const nextIndex = getNextWorkoutIndex();
  state.currentIndex = nextIndex;
  persistState();
  render();
}

function completeWorkout() {
  const workout = state.workouts[state.currentIndex];
  if (!workout) {
    return;
  }

  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  const allChecked = checkboxes.length > 0 && [...checkboxes].every((box) => box.checked);

  if (!allChecked) {
    window.alert('Check every set before submitting the workout.');
    return;
  }

  const key = getWorkoutKey(workout);
  state.completed[key] = {};
  [...checkboxes].forEach((checkbox) => {
    const exerciseId = checkbox.dataset.exerciseId;
    const setId = checkbox.dataset.setId;
    if (!state.completed[key][exerciseId]) {
      state.completed[key][exerciseId] = {};
    }
    state.completed[key][exerciseId][setId] = true;
  });
  persistState();

  const workoutRoundCount = Number(state.workoutRoundCounts[workout.fileName] || 0) + 1;
  state.workoutRoundCounts[workout.fileName] = workoutRoundCount;
  persistState();

  const currentPattern = getPrimaryPatternForWorkout(workout);
  state.history.push({
    title: workout.workoutTitle,
    date: new Date().toISOString(),
    pattern: `${currentPattern.sets}x${currentPattern.reps}`
  });
  state.history = state.history.slice(-12);
  persistState();

  const nextIndex = state.currentIndex + 1;
  if (nextIndex < state.workouts.length) {
    state.currentIndex = nextIndex;
    persistState();
    render();
    window.alert(`Workout complete. Your next program step is ready.`);
  } else {
    const allWorkoutsAtFinalPattern = state.workouts.every((item) => (state.workoutRoundCounts[item.fileName] || 0) >= PRIMARY_PATTERNS.length - 1);

    if (allWorkoutsAtFinalPattern) {
      state.currentIndex = 0;
      state.completed = {};
      state.workoutRoundCounts = {};
      persistState();
      render();
      window.alert('All workouts completed at 5x5. Increase the sandbag weight and start over at 3x3.');
    } else {
      state.currentIndex = 0;
      state.completed = {};
      persistState();
      render();
      window.alert('Program complete. Restart from the beginning and continue the working-set progression.');
    }
  }
}

function resetProgress() {
  const confirmed = window.confirm('Reset all workout progress and start again from the beginning?');
  if (!confirmed) {
    return;
  }

  state.currentIndex = 0;
  state.completed = {};
  state.workoutRoundCounts = {};
  state.history = [];
  localStorage.removeItem(STORAGE_KEY);
  persistState();
  render();

  const banner = document.getElementById('program-status');
  if (banner) {
    banner.textContent = 'Progress reset. You are back at the start of the sandbag program at 3x3.';
  }

  window.alert('Progress reset. You are back at the start of the sandbag program.');
}

async function init() {
  const isLocalhost = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

  if ('serviceWorker' in navigator && !isLocalhost) {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  }

  loadState();
  await loadWorkoutData();

  const nextWorkoutButton = document.getElementById('next-workout');
  const completeWorkoutButton = document.getElementById('complete-workout');
  const resetButton = document.getElementById('reset-progress');
  const workoutSelect = document.getElementById('workout-select');

  nextWorkoutButton.addEventListener('click', moveToNextWorkout);
  completeWorkoutButton.addEventListener('click', completeWorkout);
  resetButton.addEventListener('click', resetProgress);
  workoutSelect.addEventListener('change', (event) => {
    state.currentIndex = Number(event.target.value);
    persistState();
    render();
  });

  render();
}

init();
