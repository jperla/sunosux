// wish brick: say what you want and it goes to Claude.
// Live (npm run dev): the wish lands in wishes/inbox.md in the repo. Claude reads it,
// changes the song, the sounds, or the page itself, and the change shows up here by itself.
// Static (GitHub Pages): the wish is copied so you can paste it to Claude.
(function () {
  'use strict';
  const Kit = Sunosux.Kit, h = Kit.h;

  Kit.components.wish = (el, app) => {
    const { store } = app;
    const box = h('textarea', { class: 'sx-text', rows: 2, placeholder: 'I wish… the chorus had a tiger roar! / make a page with only giant drum pads / make it sound like a lullaby' });
    const list = h('div', { class: 'sx-wishes' });
    const note = (icon, text) => { list.prepend(h('div', { class: 'sx-wish' }, icon + ' ' + text)); while (list.children.length > 5) list.lastChild.remove(); };

    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    let hearing = null;
    const talk = Speech && h('button', { class: 'sx-big', onclick: () => {
      if (hearing) return hearing.stop();
      hearing = new Speech();
      hearing.interimResults = true;
      hearing.onresult = (e) => { box.value = Array.from(e.results).map((r) => r[0].transcript).join(' '); };
      hearing.onend = () => { hearing = null; talk.textContent = '🗣️ say it'; talk.classList.remove('on'); };
      hearing.onerror = () => Kit.toast('🙉 I could not hear the wish. You can type it instead.');
      hearing.start();
      talk.textContent = '👂 listening…'; talk.classList.add('on');
    } }, '🗣️ say it');

    const send = async () => {
      const text = box.value.trim();
      if (!text) return;
      const wish = { text, interface: location.pathname, song: app.io.path || store.song.title, part: store.selectedPart };
      if (app.live) {
        const res = await fetch('/api/wish', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, Kit.API), body: JSON.stringify(wish) }).catch(() => null);
        if (!res || !res.ok) return Kit.toast('the wish got lost: is the dev server running?');
        const out = await res.json();
        note('⭐', text + (out.agent ? '' : '  (waiting in wishes/inbox.md: tell Claude "grant the wishes")'));
      } else {
        const full = 'A wish from the sunosux studio (song: ' + wish.song + ', piece: ' + wish.part + '): ' + text;
        try { await navigator.clipboard.writeText(full); note('📋', text + '  (copied: paste it to Claude)'); } catch (e) { note('📋', full); }
      }
      box.value = '';
    };

    el.append(h('h2', {}, '⭐ Wish star'),
      h('div', { class: 'sx-small' }, 'Wish for anything: a new sound, a new piece, a different kind of song, even new buttons on this page.'),
      box, h('div', { class: 'sx-row' }, talk || null, h('button', { class: 'sx-big sx-wish-send', onclick: send }, '⭐ make a wish')), list);

    if (app.events) app.events.addEventListener('wish', (e) => {
      const w = JSON.parse(e.data);
      note({ working: '🪄', done: '✅', failed: '🙈' }[w.status] || '⭐', w.text + (w.status === 'working' ? '  (Claude is on it…)' : w.status === 'failed' ? '  (that did not work)' : ''));
    });
  };
})();
