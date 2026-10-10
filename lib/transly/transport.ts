export const pagesMode = typeof window !== 'undefined' && window.location.hostname === 'darlayx1.github.io';
export const apiOrigin = pagesMode ? 'https://transly-studio.adikagung32.chatgpt.site' : '';

const AUTH_TOKEN_KEY = 'transly.auth_token.v1';
const CREDENTIAL_TOKEN_KEY = 'transly.session_token.v1';

let authToken = '';
let credentialToken = '';

if (typeof window !== 'undefined') {
  try {
    authToken = localStorage.getItem(AUTH_TOKEN_KEY) || '';
    credentialToken = localStorage.getItem(CREDENTIAL_TOKEN_KEY) || '';
  } catch {
    authToken = '';
    credentialToken = '';
  }
}

// Login token (Supabase JWT)
export const getAuthToken = () => authToken;
export const setAuthToken = (token: string) => {
  authToken = token;
  if (typeof window !== 'undefined') {
    try {
      if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
      else localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {}
  }
};

// AI credential access token (Guest ephemeral credentials)
export const getCredentialToken = () => credentialToken;
export const setCredentialToken = (token: string) => {
  credentialToken = token;
  if (typeof window !== 'undefined') {
    try {
      if (token) localStorage.setItem(CREDENTIAL_TOKEN_KEY, token);
      else localStorage.removeItem(CREDENTIAL_TOKEN_KEY);
    } catch {}
  }
};

// Backwards-compatible aliases
export const getSessionToken = getCredentialToken;
export const setSessionToken = setCredentialToken;

export const clearAllTokens = () => {
  setAuthToken('');
  setCredentialToken('');
};
