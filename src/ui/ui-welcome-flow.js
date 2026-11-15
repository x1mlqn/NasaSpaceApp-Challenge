(() => {
  const STORAGE_KEY = 'cest-lunaire.profile.v1';
  const screen = document.getElementById('welcomeScreen');
  const appShell = document.querySelector('.app-shell');
  const form = document.getElementById('welcomeForm');
  const nameInput = document.getElementById('visitorName');
  const welcomeCard = document.getElementById('welcomeCard');
  const helloCard = document.getElementById('helloCard');
  const helloName = document.getElementById('helloName');
  const helloMode = document.getElementById('helloMode');
  const enterButton = document.getElementById('helloEnterButton');
  const greeting = document.getElementById('userGreeting');
  const profileButton = document.getElementById('profileBtn');
  const modeLabels = { public: 'Explorer', teacher: 'Teacher/Researcher' };
  let profile = null;
  let selectedMode = 'public';
  let timers = [];

  function loadProfile() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (stored && typeof stored.name === 'string' && stored.name.trim()) {
        return {
          name: stored.name.trim().slice(0, 32),
          mode: stored.mode === 'research' ? 'teacher' : Object.hasOwn(modeLabels, stored.mode) ? stored.mode : 'public'
        };
      }
    } catch (error) {
      console.info('Local profile unavailable; session preferences remain active.', error);
    }
    return null;
  }

  function updateModeChoices(mode) {
    document.querySelectorAll('[data-expertise]').forEach(button => {
      const active = button.dataset.expertise === mode;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.mode').forEach(button => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const activeLabel = document.getElementById('activeModeLabel');
    if (activeLabel) activeLabel.textContent = modeLabels[mode].toLocaleUpperCase('en-US');
    if (helloMode) helloMode.textContent = `MODE ${modeLabels[mode].toLocaleUpperCase('en-US')}`;
  }

  function applyExpertiseMode(mode, notify = false) {
    selectedMode = mode === 'research' ? 'teacher' : Object.hasOwn(modeLabels, mode) ? mode : 'public';
    document.body.dataset.expertiseMode = selectedMode;
    document.body.classList.remove('mode-public', 'mode-teacher', 'mode-research');
    document.body.classList.add(`mode-${selectedMode}`);
    updateModeChoices(selectedMode);
    if (notify) document.dispatchEvent(new CustomEvent('cest:modechange', { detail: { mode: selectedMode } }));
  }

  function saveModePreference(mode) {
    if (!Object.hasOwn(modeLabels, mode)) return;
    selectedMode = mode;
    updateModeChoices(selectedMode);
    if (profile) {
      profile = { ...profile, mode: selectedMode };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); }
      catch (error) { console.info('The selected mode remains active for this session.', error); }
    }
  }

  function applyProfile(next) {
    profile = next;
    nameInput.value = next.name;
    helloName.textContent = next.name;
    greeting.textContent = `HELLO, ${next.name.toLocaleUpperCase('en-US')}`;
    greeting.title = `Observatory customized for ${next.name}`;
    applyExpertiseMode(next.mode || 'public', true);
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function enterObservatory() {
    clearTimers();
    if(appShell){appShell.inert=false;appShell.removeAttribute('aria-hidden');}
    document.body.classList.remove('welcome-active', 'hello-active', 'welcome-editing');
    screen.setAttribute('aria-hidden', 'true');
    profileButton?.focus({ preventScroll: true });
  }

  function showHello(next) {
    clearTimers();
    if(appShell){appShell.inert=true;appShell.setAttribute('aria-hidden','true');}
    applyProfile(next);
    welcomeCard.hidden = true;
    helloCard.hidden = false;
    enterButton.disabled = true;
    document.body.classList.add('welcome-active', 'hello-active');
    document.body.classList.remove('welcome-editing');
    screen.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => helloCard.classList.add('is-arriving'));
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    timers.push(setTimeout(() => {
      enterButton.disabled = false;
      enterButton.classList.add('is-ready');
      timers.push(setTimeout(enterObservatory, reducedMotion ? 350 : 1100));
    }, reducedMotion ? 100 : 1600));
  }

  function showWelcome() {
    clearTimers();
    if(appShell){appShell.inert=true;appShell.setAttribute('aria-hidden','true');}
    if (profile) applyProfile(profile);
    welcomeCard.hidden = false;
    helloCard.hidden = true;
    helloCard.classList.remove('is-arriving');
    document.body.classList.add('welcome-active', 'welcome-editing');
    document.body.classList.remove('hello-active');
    screen.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => nameInput.focus({ preventScroll: true }));
  }

  profile = loadProfile();
  showWelcome();

  document.querySelectorAll('[data-expertise]').forEach(button => button.addEventListener('click', () => {
    if (!Object.hasOwn(modeLabels, button.dataset.expertise)) return;
    selectedMode = button.dataset.expertise;
    updateModeChoices(selectedMode);
  }));
  window.CEST_PROFILE_SET_MODE = saveModePreference;

  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 32);
    if (!name) {
      nameInput.focus();
      return;
    }
    const next = {
      name,
      mode: selectedMode
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch (error) { console.info('The profile will be saved for this session only.', error); }
    showHello(next);
  });

  enterButton.addEventListener('click', enterObservatory);
  profileButton?.addEventListener('click', showWelcome);
})();
