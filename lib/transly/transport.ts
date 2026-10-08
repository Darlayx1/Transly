export const pagesMode = typeof window !== 'undefined' && window.location.hostname === 'darlayx1.github.io';
export const apiOrigin = pagesMode ? 'https://transly-studio.adikagung32.chatgpt.site' : '';

const TOKEN_KEY = 'transly.session_token.v1';

let sessionToken = '';
if (typeof window !== 'undefined') {
  try {
    sessionToken = localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    sessionToken = '';
  }
}

export const getSessionToken = () => sessionToken;

export const setSessionToken = (token: string) => {
  sessionToken = token;
  if (typeof window !== 'undefined') {
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      // Storage unavailable fallback
    }
  }
};
