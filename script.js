const languageKey = 'universe-simulations-language';
const languages = ['en', 'de'];

function readStoredLanguage() {
  try {
    return window.localStorage.getItem(languageKey);
  } catch (error) {
    return null;
  }
}

function storeLanguage(language) {
  try {
    window.localStorage.setItem(languageKey, language);
  } catch (error) {
    // Ignore storage failures so the page still renders.
  }
}

function getPreferredLanguage() {
  const storedLanguage = readStoredLanguage();

  if (languages.includes(storedLanguage)) {
    return storedLanguage;
  }

  return document.documentElement.lang === 'de' ? 'de' : 'en';
}

function applyLanguage(language) {
  document.documentElement.lang = language;
  document.documentElement.dataset.lang = language;

  const textNodes = document.querySelectorAll('[data-lang-text]');
  textNodes.forEach((node) => {
    node.hidden = node.dataset.langText !== language;
  });

  const toggleButtons = document.querySelectorAll('[data-language-toggle]');
  toggleButtons.forEach((button) => {
    const nextLanguage = language === 'en' ? 'de' : 'en';
    button.setAttribute('aria-label', `Switch to ${nextLanguage === 'en' ? 'English' : 'German'}`);
    button.dataset.nextLanguage = nextLanguage;
  });

  storeLanguage(language);
}

function setupLanguageToggle() {
  const initialLanguage = getPreferredLanguage();
  applyLanguage(initialLanguage);

  document.querySelectorAll('[data-language-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextLanguage = document.documentElement.dataset.lang === 'en' ? 'de' : 'en';
      applyLanguage(nextLanguage);
    });
  });
}

setupLanguageToggle();