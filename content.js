// FB Reels Cleaner — Stacknix.dev
// Content Script v2
// Free tool by https://stacknix.dev
// Strategy: scan visible DOM, log what we find, use text-matching + role-based clicking

(function () {
  // Prevent double-injection
  if (window.__fbReelsCleaner) return;
  window.__fbReelsCleaner = true;

  let isRunning = false;
  let deletedCount = 0;
  let skippedCount = 0;
  let stopRequested = false;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function sendStatus(msg, type = 'info') {
    try {
      chrome.runtime.sendMessage({ action: 'status', msg, type, deletedCount, skippedCount });
    } catch (e) {}
  }

  // ─── Core DOM Helpers ────────────────────────────────────────────────────────

  function findByText(label, root = document) {
    const roles = ['button', 'menuitem', 'option', 'tab', 'link', 'menuitemradio'];
    const roleSelector = roles.map((r) => `[role="${r}"]`).join(',');
    const candidates = [...root.querySelectorAll(`button, a, ${roleSelector}`)];

    for (const el of candidates) {
      if (el.textContent.trim() === label && el.offsetParent !== null) return el;
    }
    const lower = label.toLowerCase();
    for (const el of candidates) {
      if (el.textContent.trim().toLowerCase() === lower && el.offsetParent !== null) return el;
    }
    for (const el of candidates) {
      if (el.textContent.trim().toLowerCase().includes(lower) && el.offsetParent !== null)
        return el;
    }
    return null;
  }

  function findByAriaLabel(label, root = document) {
    const lower = label.toLowerCase();
    const all = [...root.querySelectorAll('[aria-label]')];
    return (
      all.find(
        (el) =>
          el.getAttribute('aria-label').toLowerCase().includes(lower) &&
          el.offsetParent !== null
      ) || null
    );
  }

  async function pressEscape() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })
    );
    await sleep(300);
  }

  async function waitFor(selectorFn, timeout = 3000, interval = 200) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = selectorFn();
      if (el) return el;
      await sleep(interval);
    }
    return null;
  }

  // ─── Debug helpers ───────────────────────────────────────────────────────────

  function debugScanPage() {
    const info = [];
    const allBtns = [...document.querySelectorAll('[role="button"]')];
    info.push(`role=button: ${allBtns.length}`);
    const knownLabels = [
      'More options', 'More', 'Action options', 'Delete', 'Options',
      'Edit or delete', 'Reel options', 'More options for this activity',
    ];
    for (const lbl of knownLabels) {
      const found = findByAriaLabel(lbl);
      if (found) info.push(`✓ aria~="${lbl}"`);
    }
    const menus = document.querySelectorAll('[role="menu"], [role="dialog"]');
    info.push(`menus/dialogs: ${menus.length}`);
    sendStatus('[SCAN] ' + info.join(' | '), 'warn');
  }

  function dumpAriaLabels() {
    const els = [...document.querySelectorAll('[aria-label]')];
    const unique = [
      ...new Set(
        els
          .filter((e) => e.offsetParent !== null)
          .map(
            (e) =>
              `${e.tagName.toLowerCase()}[${e.getAttribute('role') || '—'}]="${e
                .getAttribute('aria-label')
                .substring(0, 40)}"`
          )
      ),
    ].slice(0, 25);
    sendStatus('[LABELS] ' + unique.join(' | '), 'warn');
  }

  // ─── Step 1: Open More Options menu ─────────────────────────────────────────

  async function openMoreOptionsMenu() {
    const labels = [
      'More options',
      'More',
      'Options for this Reel',
      'Reel options',
      'Action options',
      'More options for this activity',
      'Edit or delete this',
      'Options',
    ];

    for (const lbl of labels) {
      const el = findByAriaLabel(lbl);
      if (el) {
        sendStatus(`Clicking: "${lbl}"`, 'info');
        el.click();
        await sleep(900);
        return true;
      }
    }
    return false;
  }

  // ─── Step 2: Click Delete in open menu ──────────────────────────────────────

  async function clickDeleteInOpenMenu() {
    await sleep(500);
    const menu = document.querySelector('[role="menu"]');
    const dialog = document.querySelector('[role="dialog"]');
    const root = menu || dialog || document;

    const delBtn = findByText('Delete', root);
    if (delBtn) {
      sendStatus('Clicking "Delete"', 'info');
      delBtn.click();
      await sleep(800);
      return true;
    }

    const delByLabel = findByAriaLabel('delete', root);
    if (delByLabel) {
      delByLabel.click();
      await sleep(800);
      return true;
    }

    // Any menuitem containing delete
    const items = [...document.querySelectorAll('[role="menuitem"], [role="option"]')];
    for (const item of items) {
      if (item.textContent.toLowerCase().includes('delete') && item.offsetParent !== null) {
        item.click();
        await sleep(800);
        return true;
      }
    }

    return false;
  }

  // ─── Step 3: Confirm dialog ──────────────────────────────────────────────────

  async function confirmDeleteDialog() {
    await sleep(600);
    const dialog = await waitFor(() => document.querySelector('[role="dialog"]'), 3000);

    if (!dialog) {
      sendStatus('No confirm dialog — may have deleted directly', 'warn');
      return true;
    }

    const confirmBtn =
      findByText('Delete', dialog) ||
      findByText('Confirm', dialog) ||
      findByText('OK', dialog) ||
      findByAriaLabel('delete', dialog);

    if (confirmBtn) {
      sendStatus('Confirming deletion', 'info');
      confirmBtn.click();
      await sleep(1400);
      return true;
    }

    // Only non-cancel button
    const allDialogBtns = [
      ...dialog.querySelectorAll('[role="button"], button'),
    ].filter((b) => {
      const t = b.textContent.trim().toLowerCase();
      return t !== 'cancel' && t !== 'close' && t !== '' && b.offsetParent !== null;
    });

    if (allDialogBtns.length === 1) {
      allDialogBtns[0].click();
      await sleep(1400);
      return true;
    }

    sendStatus('Cannot find confirm button', 'error');
    await pressEscape();
    return false;
  }

  // ─── Activity Log: Find first action button ──────────────────────────────────

  function findFirstActivityActionButton() {
    const actionLabels = [
      'Action options',
      'More options for this activity',
      'Options',
      'More options',
      'Edit or delete this',
    ];

    for (const lbl of actionLabels) {
      const exact = document.querySelector(`[aria-label="${lbl}"]`);
      if (exact && exact.offsetParent !== null) return exact;

      const all = [...document.querySelectorAll(`[aria-label*="${lbl.split(' ')[0]}"]`)];
      for (const e of all) {
        if (e.offsetParent !== null) return e;
      }
    }

    return null;
  }

  // ─── Delete All via Activity Log ─────────────────────────────────────────────

  async function deleteAllReelsActivityLog() {
    isRunning = true;
    stopRequested = false;
    deletedCount = 0;
    skippedCount = 0;

    sendStatus('Scanning Activity Log...', 'info');
    await sleep(1500);
    debugScanPage();
    dumpAriaLabels();
    await sleep(500);

    const maxRounds = 300;
    let round = 0;
    let consecutiveFailures = 0;

    while (!stopRequested && round < maxRounds) {
      round++;

      const actionBtn = findFirstActivityActionButton();

      if (!actionBtn) {
        sendStatus(`Round ${round}: No action buttons on page.`, 'warn');
        consecutiveFailures++;

        if (consecutiveFailures === 1) {
          window.scrollTo(0, 0);
          await sleep(1500);
          debugScanPage();
          dumpAriaLabels();
        } else if (consecutiveFailures >= 3) {
          sendStatus('No more entries. Done!', 'success');
          break;
        }
        await sleep(1500);
        continue;
      }

      consecutiveFailures = 0;
      sendStatus(`Round ${round}: Clicking action button...`, 'info');
      actionBtn.click();
      await sleep(1000);

      const menu = document.querySelector('[role="menu"]');
      if (!menu) {
        sendStatus('Menu did not open.', 'warn');
        await pressEscape();
        await sleep(800);
        skippedCount++;
        continue;
      }

      const menuItemTexts = [...menu.querySelectorAll('[role="menuitem"]')]
        .map((i) => i.textContent.trim())
        .join(' | ');
      sendStatus(`Menu: ${menuItemTexts}`, 'info');

      const deleted = await clickDeleteInOpenMenu();
      if (!deleted) {
        sendStatus('No Delete in menu — skipping this entry.', 'warn');
        await pressEscape();
        await sleep(800);
        skippedCount++;
        if (skippedCount > 10) {
          sendStatus('Too many non-deletable entries. Stopping.', 'error');
          break;
        }
        continue;
      }

      const confirmed = await confirmDeleteDialog();
      if (confirmed) {
        deletedCount++;
        sendStatus(`✓ Reel #${deletedCount} deleted!`, 'success');
      } else {
        skippedCount++;
        sendStatus(`Skipped. Total skipped: ${skippedCount}`, 'warn');
      }

      await sleep(2200);
    }

    sendStatus(`Done! Deleted: ${deletedCount} | Skipped: ${skippedCount}`, 'success');
    isRunning = false;
  }

  // ─── Reel Viewer: Delete current reel ───────────────────────────────────────

  async function deleteCurrentViewingReel() {
    sendStatus('Looking for More Options...', 'info');
    const opened = await openMoreOptionsMenu();
    if (!opened) {
      sendStatus('More Options not found. Are you viewing a Reel?', 'error');
      debugScanPage();
      dumpAriaLabels();
      return false;
    }

    const deleted = await clickDeleteInOpenMenu();
    if (!deleted) {
      const items = [...document.querySelectorAll('[role="menuitem"]')];
      sendStatus(`Menu had: ${items.map((i) => i.textContent.trim()).join(' | ')}`, 'warn');
      await pressEscape();
      return false;
    }

    return await confirmDeleteDialog();
  }

  async function deleteOneAndGoNext() {
    if (isRunning) return;
    isRunning = true;

    const deleted = await deleteCurrentViewingReel();
    if (deleted) {
      deletedCount++;
      sendStatus(`Deleted! Total: ${deletedCount}. Finding next...`, 'success');
      await sleep(800);
      const nextBtn =
        findByAriaLabel('next reel') || findByAriaLabel('next') || findByText('Next');
      if (nextBtn) {
        nextBtn.click();
        sendStatus('Moved to next reel', 'info');
      } else {
        sendStatus('No Next button — navigate manually', 'warn');
      }
    }

    isRunning = false;
  }

  async function autoDeleteWhileViewing() {
    isRunning = true;
    stopRequested = false;
    deletedCount = 0;

    sendStatus('Auto-deleting reels...', 'info');
    const maxReels = 500;
    let count = 0;
    let failures = 0;

    while (!stopRequested && count < maxReels) {
      count++;
      await sleep(800);

      const deleted = await deleteCurrentViewingReel();
      if (deleted) {
        deletedCount++;
        failures = 0;
        sendStatus(`Deleted ${deletedCount} reel(s). Going next...`, 'success');
        await sleep(1500);
      } else {
        failures++;
        if (failures >= 5) {
          sendStatus('Too many failures. Stopping.', 'error');
          break;
        }
        await sleep(800);
      }

      const nextBtn =
        findByAriaLabel('next reel') || findByAriaLabel('next') || findByText('Next');
      if (nextBtn) {
        nextBtn.click();
        await sleep(1800);
      } else {
        sendStatus('No more reels. Done!', 'success');
        break;
      }
    }

    sendStatus(`Auto-delete done. Deleted: ${deletedCount}`, 'success');
    isRunning = false;
  }

  // ─── Message Listener ────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'deleteOne') {
      if (isRunning) { sendResponse({ ok: false, msg: 'Already running' }); return; }
      deleteOneAndGoNext();
      sendResponse({ ok: true });
    }
    if (msg.action === 'deleteAllActivityLog') {
      if (isRunning) { sendResponse({ ok: false, msg: 'Already running' }); return; }
      deleteAllReelsActivityLog();
      sendResponse({ ok: true });
    }
    if (msg.action === 'autoDeleteViewing') {
      if (isRunning) { sendResponse({ ok: false, msg: 'Already running' }); return; }
      autoDeleteWhileViewing();
      sendResponse({ ok: true });
    }
    if (msg.action === 'stop') {
      stopRequested = true;
      isRunning = false;
      sendStatus('Stopped.', 'warn');
      sendResponse({ ok: true });
    }
    if (msg.action === 'debug') {
      debugScanPage();
      dumpAriaLabels();
      sendResponse({ ok: true });
    }
    if (msg.action === 'ping') {
      sendResponse({ ok: true, isRunning });
    }
  });

  sendStatus('FB Reels Cleaner by Stacknix.dev ready.', 'success');
})();
