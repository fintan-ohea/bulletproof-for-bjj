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
const HISTORY_LIMIT = 30;

const state = {
  workouts: [],
  currentIndex: 0,
  completed: {},
  workoutRoundCounts: {},
  history: [],
  restTimer: {
    intervalId: null,
    endTime: 0,
    duration: 0,
    lastBeepSecond: null,
    hideTimeoutId: null
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

function getProgressSnapshot() {
  return {
    currentIndex: state.currentIndex,
    completed: state.completed,
    workoutRoundCounts: state.workoutRoundCounts,
    history: state.history
  };
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getProgressSnapshot()));
}

function getWorkoutKey(workout) {
  return workout.fileName;
}

function getPrimaryPatternIndex(workout) {
  const count = Number(state.workoutRoundCounts[workout.fileName] || 0);
  return Math.min(count, PRIMARY_PATTERNS.length - 1);
}

function getPrimaryPatternForWorkout(workout) {
  return PRIMARY_PATTERNS[getPrimaryPatternIndex(workout)] || PRIMARY_PATTERNS[0];
}

function formatPattern(pattern) {
  return `${pattern.sets}×${pattern.reps}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toTitleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeWorkoutTitle(value, index) {
  const match = String(value || '').match(/workout\s*(\d+)/i);
  return match ? `Workout ${match[1]}` : toTitleCase(value) || `Workout ${index + 1}`;
}

const VIDEO_BASE_URL = 'https://d3742cffkcu4i8.cloudfront.net/';

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

function getBlockNote(blockTitle = '') {
  const [, note] = blockTitle.split(':');
  if (!note) {
    return '';
  }
  const trimmed = note.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function parseBlockRest(blockTitle = '') {
  const match = blockTitle.match(/rest\s+(\d+)\s*sec(?:onds?)?(?:\s+after\s+exercise\s*(\d+))?/i);
  if (!match) {
    return null;
  }

  return {
    seconds: Number(match[1]),
    afterExercise: match[2] ? Number(match[2]) : null
  };
}

function getExerciseRestSeconds(block, progression, exerciseIndex) {
  const progressionRest = Number(
    progression.rest_time_after_exercise ??
      progression.restTimeAfterExercise ??
      progression.rest_time ??
      progression.restTime ??
      progression.rest_after_exercise
  );

  if (Number.isFinite(progressionRest) && progressionRest > 0) {
    return progressionRest;
  }

  const blockRest = parseBlockRest(block.title || '');
  if (!blockRest) {
    return 0;
  }

  // "Rest 90 sec after exercise 2" only applies to the second exercise in the block.
  if (blockRest.afterExercise && blockRest.afterExercise !== exerciseIndex + 1) {
    return 0;
  }

  return blockRest.seconds;
}

function flattenExercises(workoutData) {
  const exercises = [];

  workoutData.forEach((block) => {
    const allExercise = block.allExercise || [];
    allExercise.forEach((exercise, exerciseIndex) => {
      const progression = exercise.allProgression || exercise.allProgressions?.[0] || {};
      const demoVideo = progression.demoVideoData || exercise.demoVideoData || {};
      const instructVideo = progression.instructVideoData || exercise.instructVideoData || {};

      exercises.push({
        id: exercise._id || `${block._id}-${exercise.title}`,
        title: exercise.title || 'Exercise',
        phase: block.session_stage_detail?.title || 'Workout',
        blockNote: getBlockNote(block.title || ''),
        notes: progression.note || '',
        sets: progression.sets || [],
        restSeconds: getExerciseRestSeconds(block, progression, exerciseIndex),
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

    return {
      fileName: PROGRAM_FILES[index],
      cycleTitle: toTitleCase(payload.cycleData?.title) || 'Program workout',
      workoutTitle: normalizeWorkoutTitle(payload.title, index),
      exercises: flattenExercises(payload.workoutData || []),
      id: PROGRAM_FILES[index]
    };
  });

  if (state.currentIndex >= state.workouts.length) {
    state.currentIndex = state.workouts.length - 1;
  }
}

function selectWorkout(index) {
  state.currentIndex = index;
  persistState();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderProgramRail() {
  const programRail = document.getElementById('program-rail');
  programRail.innerHTML = '';

  state.workouts.forEach((workout, index) => {
    const rounds = Number(state.workoutRoundCounts[workout.fileName] || 0);
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `stage-pill ${index === state.currentIndex ? 'active' : ''}`;
    pill.innerHTML = `
      <span class="stage-pill-text">
        <strong>${escapeHtml(workout.cycleTitle)}</strong>
        <small>${escapeHtml(workout.workoutTitle)}</small>
      </span>
      <span class="stage-pill-badge" title="Next target">${formatPattern(getPrimaryPatternForWorkout(workout))}</span>
      ${rounds ? `<span class="stage-pill-rounds" title="Times completed">✓${rounds}</span>` : ''}
    `;
    pill.addEventListener('click', () => selectWorkout(index));
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
          ${index + 1}. ${escapeHtml(workout.cycleTitle)} · ${escapeHtml(workout.workoutTitle)} (${formatPattern(getPrimaryPatternForWorkout(workout))})
        </option>
      `
    )
    .join('');
}

function getExerciseSetId(exercise, index) {
  return exercise.sets?.[index]?._id || `${exercise.id}-set-${index + 1}`;
}

function isPrimaryExercise(exercise) {
  return (exercise.phase || '').toLowerCase() === 'primary';
}

function getExerciseSetsForDisplay(exercise, workout) {
  if (isPrimaryExercise(exercise)) {
    const primaryPattern = getPrimaryPatternForWorkout(workout);
    return Array.from({ length: primaryPattern.sets }, (_, index) => ({
      title: String(primaryPattern.reps),
      _id: `${exercise.id}-set-${index + 1}`
    }));
  }

  return Array.isArray(exercise.sets) && exercise.sets.length > 0 ? exercise.sets : [{ title: '1', _id: `${exercise.id}-set-1` }];
}

function getSetCheckboxes() {
  return document.querySelectorAll('#exercise-list input[type="checkbox"]');
}

function setCompletion(workout, exerciseId, setId, isComplete) {
  const key = getWorkoutKey(workout);
  if (!state.completed[key]) {
    state.completed[key] = {};
  }
  if (!state.completed[key][exerciseId]) {
    state.completed[key][exerciseId] = {};
  }
  state.completed[key][exerciseId][setId] = isComplete;
}

function updateExerciseCard(container) {
  const boxes = [...container.querySelectorAll('input[type="checkbox"]')];
  const done = boxes.length > 0 && boxes.every((box) => box.checked);
  container.classList.toggle('done', done);
  boxes.forEach((box) => box.closest('.set-chip').classList.toggle('checked', box.checked));

  const markAllButton = container.querySelector('.mark-all-btn');
  if (markAllButton) {
    markAllButton.textContent = done ? 'Undo' : 'Mark all done';
  }
}

function updateSubmitAvailability() {
  const submitButton = document.getElementById('complete-workout');
  const boxes = [...getSetCheckboxes()];
  const doneCount = boxes.filter((box) => box.checked).length;
  const allDone = boxes.length > 0 && doneCount === boxes.length;

  submitButton.disabled = !allDone;
  submitButton.innerHTML = allDone
    ? 'Complete workout ✓'
    : `Complete workout <span class="submit-count">${doneCount}/${boxes.length} sets</span>`;

  const progressFill = document.getElementById('workout-progress-fill');
  if (progressFill) {
    progressFill.style.width = boxes.length ? `${(doneCount / boxes.length) * 100}%` : '0%';
  }
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
    <div class="video-modal-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}">
      <div class="video-modal-header">
        <h3>${escapeHtml(label)}</h3>
        <button type="button" class="video-close-btn" aria-label="Close video">✕</button>
      </div>
      <video class="video-player" controls playsinline autoplay loop>
        <source src="${escapeHtml(videoUrl)}" type="video/mp4" />
        Your browser does not support HTML5 video.
      </video>
    </div>
  `;

  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', onKeyDown);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  };

  modal.querySelector('.video-close-btn').addEventListener('click', closeModal);
  modal.querySelector('[data-close-modal="true"]').addEventListener('click', closeModal);
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(modal);
}

function showToast(message, { duration = 3200 } = {}) {
  const container = document.getElementById('toast-container');
  if (!container) {
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Rest timer

let audioContext = null;

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

function beepTimerTone(durationSeconds = 0.08, frequency = 880) {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = 'square';
  oscillator.frequency.value = frequency;
  gainNode.gain.value = 0.05;

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start();
  gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationSeconds + 0.02);
  oscillator.stop(context.currentTime + durationSeconds + 0.03);
}

function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function stopRestTimer() {
  const timer = state.restTimer;
  if (timer.intervalId) {
    clearInterval(timer.intervalId);
    timer.intervalId = null;
  }
  if (timer.hideTimeoutId) {
    clearTimeout(timer.hideTimeoutId);
    timer.hideTimeoutId = null;
  }
  timer.lastBeepSecond = null;
  document.getElementById('rest-timer-bar').classList.remove('visible', 'finished');
}

function updateRestTimer() {
  const timer = state.restTimer;
  const bar = document.getElementById('rest-timer-bar');
  const remainingSeconds = Math.max(0, Math.ceil((timer.endTime - Date.now()) / 1000));

  document.getElementById('rest-timer-time').textContent = formatClock(remainingSeconds);
  document.getElementById('rest-timer-fill').style.width = `${Math.min(100, (remainingSeconds / timer.duration) * 100)}%`;

  if (remainingSeconds <= 3 && remainingSeconds > 0 && timer.lastBeepSecond !== remainingSeconds) {
    beepTimerTone();
    timer.lastBeepSecond = remainingSeconds;
  }

  if (remainingSeconds <= 0) {
    clearInterval(timer.intervalId);
    timer.intervalId = null;
    bar.classList.add('finished');
    document.getElementById('rest-timer-label').textContent = 'Rest over — go!';
    beepTimerTone(0.35, 660);
    if (navigator.vibrate) {
      navigator.vibrate([250, 120, 250]);
    }
    timer.hideTimeoutId = setTimeout(stopRestTimer, 5000);
  }
}

function startRestTimer(seconds) {
  stopRestTimer();
  // Create/resume the audio context during the tap so iOS lets it beep later.
  getAudioContext();

  const timer = state.restTimer;
  timer.duration = seconds;
  timer.endTime = Date.now() + seconds * 1000;

  document.getElementById('rest-timer-label').textContent = `Resting ${seconds}s`;
  document.getElementById('rest-timer-bar').classList.add('visible');
  updateRestTimer();
  timer.intervalId = setInterval(updateRestTimer, 250);
}

function addRestTime(seconds) {
  const timer = state.restTimer;
  if (!timer.intervalId) {
    return;
  }
  timer.endTime += seconds * 1000;
  timer.duration += seconds;
  updateRestTimer();
}

// Workout rendering

function renderExerciseCard(exercise, workout) {
  const container = document.createElement('article');
  container.className = 'exercise-item';

  const key = getWorkoutKey(workout);
  const exerciseSets = getExerciseSetsForDisplay(exercise, workout);

  const setChips = exerciseSets
    .map((set, index) => {
      const setId = getExerciseSetId(exercise, index);
      const isComplete = Boolean(state.completed[key]?.[exercise.id]?.[setId]);
      const reps = String(set.title || '').trim();

      return `
        <label class="set-chip">
          <input
            type="checkbox"
            data-exercise-id="${escapeHtml(exercise.id)}"
            data-set-id="${escapeHtml(setId)}"
            ${isComplete ? 'checked' : ''}
          />
          <span class="set-chip-num">Set ${index + 1}</span>
          ${reps ? `<span class="set-chip-reps">${escapeHtml(reps)}</span>` : ''}
        </label>
      `;
    })
    .join('');

  const mediaButtons = [];
  if (exercise.demoMediaUrl) {
    mediaButtons.push(`
      <button type="button" class="video-btn" data-video-url="${escapeHtml(exercise.demoMediaUrl)}" data-video-label="${escapeHtml(exercise.title)} — demo" aria-label="Demo video">
        ▶<span class="btn-text"> Demo</span>
      </button>
    `);
  }
  if (exercise.instructMediaUrl) {
    mediaButtons.push(`
      <button type="button" class="video-btn" data-video-url="${escapeHtml(exercise.instructMediaUrl)}" data-video-label="${escapeHtml(exercise.title)} — how to" aria-label="How-to video">
        ⓘ<span class="btn-text"> How to</span>
      </button>
    `);
  }

  const summary = isPrimaryExercise(exercise)
    ? `${formatPattern(getPrimaryPatternForWorkout(workout))} reps`
    : `${exerciseSets.length} ${exerciseSets.length === 1 ? 'set' : 'sets'}`;

  container.innerHTML = `
    <div class="exercise-heading-row">
      <div>
        <h3 class="exercise-title"><span class="exercise-check" aria-hidden="true">✓</span>${escapeHtml(exercise.title)}</h3>
        <div class="exercise-meta">${summary}</div>
      </div>
      ${mediaButtons.length ? `<div class="exercise-video-actions">${mediaButtons.join('')}</div>` : ''}
    </div>
    ${exercise.notes ? `<div class="exercise-notes">${escapeHtml(exercise.notes)}</div>` : ''}
    <div class="set-list">${setChips}</div>
    <div class="exercise-actions">
      <button type="button" class="mark-all-btn">Mark all done</button>
      ${exercise.restSeconds ? `<button type="button" class="rest-btn" data-seconds="${exercise.restSeconds}">⏱ Rest ${exercise.restSeconds}s</button>` : ''}
    </div>
  `;

  const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')];

  container.querySelectorAll('.video-btn').forEach((button) => {
    button.addEventListener('click', () => openVideoModal(button.dataset.videoUrl, button.dataset.videoLabel));
  });

  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      setCompletion(workout, exercise.id, checkbox.dataset.setId, checkbox.checked);
      persistState();
      updateExerciseCard(container);
      updateSubmitAvailability();
    });
  });

  container.querySelector('.mark-all-btn').addEventListener('click', () => {
    const markDone = !checkboxes.every((checkbox) => checkbox.checked);
    checkboxes.forEach((checkbox) => {
      checkbox.checked = markDone;
      setCompletion(workout, exercise.id, checkbox.dataset.setId, markDone);
    });
    persistState();
    updateExerciseCard(container);
    updateSubmitAvailability();
  });

  const restButton = container.querySelector('.rest-btn');
  if (restButton) {
    restButton.addEventListener('click', () => startRestTimer(Number(restButton.dataset.seconds)));
  }

  updateExerciseCard(container);
  return container;
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

    const blockNotes = [...new Set(exercises.map((exercise) => exercise.blockNote).filter(Boolean))];
    const header = document.createElement('div');
    header.className = 'phase-header';
    header.innerHTML = `
      <h2 class="phase-title">${phaseTitle}</h2>
      ${blockNotes.length ? `<p class="phase-note">${escapeHtml(blockNotes.join(' · '))}</p>` : ''}
    `;

    if (phaseTitle === 'Primary') {
      const quickRest = document.createElement('div');
      quickRest.className = 'quick-rest';
      quickRest.innerHTML = `
        <button type="button" class="rest-btn" data-seconds="60">⏱ 60s</button>
        <button type="button" class="rest-btn" data-seconds="90">⏱ 90s</button>
      `;
      quickRest.querySelectorAll('.rest-btn').forEach((button) => {
        button.addEventListener('click', () => startRestTimer(Number(button.dataset.seconds)));
      });
      header.appendChild(quickRest);
    }

    section.appendChild(header);

    const exerciseGroup = document.createElement('div');
    exerciseGroup.className = 'exercise-group';
    exercises.forEach((exercise) => exerciseGroup.appendChild(renderExerciseCard(exercise, workout)));
    section.appendChild(exerciseGroup);

    exerciseList.appendChild(section);
  });

  updateSubmitAvailability();
}

function formatRelativeDate(isoDate) {
  const date = new Date(isoDate);
  const startOfDay = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);

  if (days === 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function renderProgressCard() {
  const card = document.getElementById('rep-summary');
  const workout = state.workouts[state.currentIndex];
  if (!card || !workout) {
    return;
  }

  const patternIndex = getPrimaryPatternIndex(workout);
  const pattern = PRIMARY_PATTERNS[patternIndex];
  const nextPattern = PRIMARY_PATTERNS[patternIndex + 1];
  const nextHint = nextPattern
    ? `Next time: ${formatPattern(nextPattern)}`
    : 'Top of the ladder — go heavier once every workout hits 5×5';

  const ladder = PRIMARY_PATTERNS.map(
    (item, index) =>
      `<span class="ladder-step ${index < patternIndex ? 'past' : ''} ${index === patternIndex ? 'current' : ''}">${formatPattern(item)}</span>`
  ).join('');

  card.innerHTML = `
    <div class="progress-card-row">
      <div>
        <span class="progress-card-label">Primary lifts today</span>
        <strong class="progress-card-target">${pattern.sets} sets × ${pattern.reps} reps</strong>
      </div>
      <span class="progress-card-position">Workout ${state.currentIndex + 1} of ${state.workouts.length}</span>
    </div>
    <div class="ladder" aria-label="Rep progression">${ladder}</div>
    <p class="progress-card-hint">${nextHint}</p>
    <div class="workout-progress" aria-hidden="true"><div id="workout-progress-fill" class="workout-progress-fill"></div></div>
  `;
}

function renderHistoryList() {
  const historyList = document.getElementById('history-list');
  if (!historyList) {
    return;
  }

  const recent = state.history.slice().reverse();
  const historyItems = recent.length
    ? recent
        .map(
          (entry) => `
            <div class="history-item">
              <span>${escapeHtml(entry.title)}</span>
              <small>${escapeHtml(String(entry.pattern || '').replace('x', '×'))} · ${formatRelativeDate(entry.date)}</small>
            </div>
          `
        )
        .join('')
    : '<div class="history-item"><span>No completed workouts yet</span><small>Finish your first one!</small></div>';

  const lastSummary = recent.length ? `Last: ${formatRelativeDate(recent[0].date)}` : 'None yet';

  historyList.innerHTML = `
    <details class="history-panel">
      <summary class="history-panel-summary">
        <span>History <span class="history-panel-count">${recent.length}</span></span>
        <small class="history-panel-last">${lastSummary}</small>
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

  document.getElementById('program-label').textContent = currentWorkout.cycleTitle;
  document.getElementById('workout-title').textContent = currentWorkout.workoutTitle;
}

function render() {
  renderProgramRail();
  renderWorkoutSelectorDropdown();
  renderCurrentWorkout();
  renderProgressCard();
  renderHistoryList();
  renderExerciseList();
}

function moveToNextWorkout() {
  selectWorkout((state.currentIndex + 1) % state.workouts.length);
}

function completeWorkout() {
  const workout = state.workouts[state.currentIndex];
  if (!workout) {
    return;
  }

  const checkboxes = [...getSetCheckboxes()];
  const allChecked = checkboxes.length > 0 && checkboxes.every((box) => box.checked);

  if (!allChecked) {
    showToast('Tick off every set before completing the workout.');
    return;
  }

  stopRestTimer();

  const key = getWorkoutKey(workout);
  const currentPattern = getPrimaryPatternForWorkout(workout);
  delete state.completed[key];

  state.workoutRoundCounts[workout.fileName] = Number(state.workoutRoundCounts[workout.fileName] || 0) + 1;
  state.history.push({
    title: `${workout.cycleTitle} · ${workout.workoutTitle}`,
    date: new Date().toISOString(),
    pattern: `${currentPattern.sets}x${currentPattern.reps}`
  });
  state.history = state.history.slice(-HISTORY_LIMIT);

  const nextIndex = state.currentIndex + 1;
  let message;
  if (nextIndex < state.workouts.length) {
    state.currentIndex = nextIndex;
    message = '💪 Workout complete! Next one is ready.';
  } else {
    const allWorkoutsAtFinalPattern = state.workouts.every(
      (item) => (state.workoutRoundCounts[item.fileName] || 0) >= PRIMARY_PATTERNS.length - 1
    );

    state.currentIndex = 0;
    state.completed = {};
    if (allWorkoutsAtFinalPattern) {
      state.workoutRoundCounts = {};
      message = '🏆 Every workout done at 5×5! Increase the sandbag weight and start again at 3×3.';
    } else {
      message = '🎉 Program complete! Back to the start with the next rep target.';
    }
  }

  persistState();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast(message, { duration: 5000 });
}

function resetProgress() {
  const confirmed = window.confirm('Reset all workout progress and start again from the beginning? This cannot be undone — export first if you want a backup.');
  if (!confirmed) {
    return;
  }

  state.currentIndex = 0;
  state.completed = {};
  state.workoutRoundCounts = {};
  state.history = [];
  persistState();
  render();
  showToast('Progress reset. Back to the start at 3×3.');
}

// Export / import

const EXPORT_FORMAT = 'sandbag-progress';

async function exportProgress() {
  const payload = {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    progress: getProgressSnapshot()
  };
  const json = JSON.stringify(payload, null, 2);
  const fileName = `sandbag-progress-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], fileName, { type: 'application/json' });

  // On phones, the share sheet is the easiest way to send the file to another device.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Sandbag progress' });
      return;
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }
      console.warn('Share failed, falling back to download.', error);
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Saved ${fileName}`);
}

function parseImportedProgress(text) {
  const parsed = JSON.parse(text);
  const progress = parsed && parsed.format === EXPORT_FORMAT ? parsed.progress : parsed;

  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (
    !isObject(progress) ||
    !Number.isInteger(progress.currentIndex) ||
    !isObject(progress.completed || {}) ||
    !isObject(progress.workoutRoundCounts || {}) ||
    !Array.isArray(progress.history || [])
  ) {
    throw new Error('File does not contain sandbag progress.');
  }

  return {
    currentIndex: Math.min(Math.max(progress.currentIndex, 0), Math.max(state.workouts.length - 1, 0)),
    completed: progress.completed || {},
    workoutRoundCounts: progress.workoutRoundCounts || {},
    history: progress.history || []
  };
}

async function importProgressFile(file) {
  let progress;
  try {
    progress = parseImportedProgress(await file.text());
  } catch (error) {
    console.warn('Import failed.', error);
    showToast('That file could not be imported. Pick a progress file exported from this app.', { duration: 5000 });
    return;
  }

  const confirmed = window.confirm('Importing will replace the progress on this device. Continue?');
  if (!confirmed) {
    return;
  }

  Object.assign(state, progress);
  persistState();
  render();
  showToast('✓ Progress imported.');
}

// Menu

function setupMenu() {
  const toggle = document.getElementById('menu-toggle');
  const menu = document.getElementById('app-menu');

  const setOpen = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(menu.hidden);
  });
  menu.addEventListener('click', () => setOpen(false));
  document.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(event.target)) {
      setOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
    }
  });
}

// Keep the screen awake while the app is open so the phone does not lock between sets.
let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) {
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch (error) {
    // Not allowed right now (e.g. low battery mode); try again on the next interaction.
  }
}

async function init() {
  const isLocalhost = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

  if ('serviceWorker' in navigator && !isLocalhost) {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  }

  loadState();
  try {
    await loadWorkoutData();
  } catch (error) {
    console.error(error);
    document.getElementById('exercise-list').innerHTML = '<p>Could not load the workouts. Check your connection and reload.</p>';
    return;
  }

  setupMenu();

  const importFileInput = document.getElementById('import-file');
  document.getElementById('next-workout').addEventListener('click', moveToNextWorkout);
  document.getElementById('complete-workout').addEventListener('click', completeWorkout);
  document.getElementById('reset-progress').addEventListener('click', resetProgress);
  document.getElementById('export-progress').addEventListener('click', exportProgress);
  document.getElementById('import-progress').addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', async () => {
    const [file] = importFileInput.files;
    importFileInput.value = '';
    if (file) {
      await importProgressFile(file);
    }
  });
  document.getElementById('workout-select').addEventListener('change', (event) => {
    selectWorkout(Number(event.target.value));
  });

  document.getElementById('rest-timer-add').addEventListener('click', () => addRestTime(15));
  document.getElementById('rest-timer-stop').addEventListener('click', stopRestTimer);

  requestWakeLock();
  document.addEventListener('click', requestWakeLock);
  document.addEventListener('visibilitychange', requestWakeLock);

  render();
}

init();
