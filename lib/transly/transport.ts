export const pagesMode = typeof window !== 'undefined' && window.location.hostname === 'darlayx1.github.io';
export const apiOrigin = pagesMode ? 'https://transly-studio.adikagung32.chatgpt.site' : '';
let sessionToken = '';
export const getSessionToken = () => sessionToken;
export const setSessionToken = (token: string) => { sessionToken = token; };
