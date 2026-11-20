/**
 * env.js — picks production or the stage sandbox by hostname. Loads first.
 *
 * Only https://aioinventory.vercel.app talks to production (Firebase project
 * aio-inventory-b9b29). Every other host — the stage branch, other Vercel
 * previews, localhost — talks to the sandbox project aio-inventory-stage, so
 * nothing outside production can touch real data.
 */
const ENV = (() => {
  const PROD_HOST = 'aioinventory.vercel.app';
  // Hosts that serve /__/auth themselves (vercel.json rewrite) and are
  // registered as redirect URIs in Entra; anywhere else signs in via firebaseapp.com.
  const STAGE_AUTH_HOSTS = ['aioinventory-stage.vercel.app', 'aioinventory-git-stage-aioapp1.vercel.app'];

  const isProd = location.hostname === PROD_HOST;

  const firebase = isProd ? {
    apiKey:            "AIzaSyCwlZg9YaGfQDKuVBDI4RAkEzKcDg7Cgdo",
    authDomain:        PROD_HOST,
    projectId:         "aio-inventory-b9b29",
    storageBucket:     "aio-inventory-b9b29.firebasestorage.app",
    messagingSenderId: "146229036238",
    appId:             "1:146229036238:web:c91467e73e3e2912683c9f"
  } : {
    apiKey:            "AIzaSyCmoMjVETyPBztpQ4NUjvfyuXLKUefqRSY",
    authDomain:        STAGE_AUTH_HOSTS.includes(location.hostname) ? location.hostname : "aio-inventory-stage.firebaseapp.com",
    projectId:         "aio-inventory-stage",
    storageBucket:     "aio-inventory-stage.firebasestorage.app",
    messagingSenderId: "76517979144",
    appId:             "1:76517979144:web:ec6dd447d3edf7d4c88dbd"
  };

  const functionsBase = `https://us-central1-${firebase.projectId}.cloudfunctions.net`;

  if (!isProd) {
    document.addEventListener('DOMContentLoaded', () => {
      const b = document.createElement('div');
      b.textContent = 'STAGE — sandbox copy, changes here do not affect real inventory';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#f59e0b;color:#111;' +
        'font:600 12px/22px system-ui,sans-serif;text-align:center;pointer-events:none;';
      document.body.appendChild(b);
      document.body.style.paddingTop = '22px';
      document.title = '[STAGE] ' + document.title;
    });
  }

  return { isProd, firebase, functionsBase };
})();
