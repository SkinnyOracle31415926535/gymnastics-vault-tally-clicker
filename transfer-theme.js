/* Makes the temporary migration controls use Tally Clicker's brat green-and-black interface. */
(() => {
  "use strict";

  const styleMarkers = [
    ".ryan-transfer-open{",
    ".ryan-semantic-sync-open{",
    ".ryan-v3-recovery-open{",
  ];
  const dialogs = ".ryan-transfer-dialog, .ryan-semantic-sync-dialog, .ryan-v3-recovery-dialog";
  const cards = ".ryan-transfer-card, .ryan-semantic-sync-card, .ryan-v3-recovery-card";
  const titles = ".ryan-transfer-card h2, .ryan-semantic-sync-card h2, .ryan-v3-recovery-card h2";
  const statusPanels = [
    ".ryan-transfer-status", ".ryan-transfer-preview", ".ryan-transfer-recovery", ".ryan-transfer-sync",
    ".ryan-semantic-sync-status", ".ryan-semantic-sync-card section",
    ".ryan-v3-recovery-card [data-status]",
  ].join(", ");
  const actionRows = ".ryan-transfer-actions, .ryan-semantic-sync-actions, .ryan-v3-recovery-actions";

  function addClass(selector, className) {
    document.querySelectorAll(selector).forEach((element) => element.classList.add(className));
  }

  function applyTheme() {
    if (document.querySelector('style[data-ryan-transfer-theme="tally-clicker"]')) return;
    document.querySelectorAll("style").forEach((style) => {
      if (styleMarkers.some((marker) => style.textContent.includes(marker))) style.remove();
    });
    addClass(dialogs, "counter-dialog");
    addClass(cards, "dialog-content");
    addClass(titles, "dialog-title");
    addClass(statusPanels, "reset-step");
    addClass(actionRows, "dialog-actions");

    const style = document.createElement("style");
    style.dataset.ryanTransferTheme = "tally-clicker";
    style.textContent = `
      .ryan-transfer-open{position:fixed!important;right:10px!important;bottom:10px!important;z-index:2147483000!important}
      .ryan-semantic-sync-open{position:fixed!important;left:10px!important;bottom:10px!important;z-index:2147482998!important}
      .ryan-v3-recovery-open{position:fixed!important;left:10px!important;bottom:72px!important;z-index:2147482996!important}
      ${dialogs}{width:min(560px,calc(100% - 24px))!important;max-height:calc(100vh - 24px)!important;margin:auto!important;overflow:auto!important}
      .ryan-transfer-dialog{z-index:2147483001!important}
      .ryan-semantic-sync-dialog{z-index:2147482999!important}
      .ryan-v3-recovery-dialog{z-index:2147482997!important}
      .ryan-transfer-card > header,.ryan-semantic-sync-card > header,.ryan-v3-recovery-card > header{display:flex!important;align-items:flex-start!important;justify-content:space-between!important;gap:10px!important}
      .ryan-transfer-card > header h2,.ryan-semantic-sync-card > header h2,.ryan-v3-recovery-card > header h2{min-width:0!important}
      .ryan-transfer-actions,.ryan-semantic-sync-actions,.ryan-v3-recovery-actions,.ryan-semantic-conflict-actions,.ryan-transfer-conflict-actions{gap:10px!important}
      ${statusPanels}{margin-top:0!important;text-align:left!important;line-height:1.15!important}
      .ryan-transfer-preview h3,.ryan-transfer-recovery h3,.ryan-transfer-sync h3,.ryan-semantic-sync-card h3{margin-top:0!important;text-transform:lowercase!important}
      .ryan-transfer-conflict,.ryan-semantic-conflict{display:grid!important;gap:8px!important;margin-top:8px!important}
      @media(max-width:520px){.ryan-transfer-open{right:6px!important;bottom:6px!important}.ryan-semantic-sync-open{left:6px!important;bottom:6px!important}.ryan-v3-recovery-open{left:6px!important;bottom:68px!important}}
    `;
    document.head.append(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyTheme, { once: true });
  else applyTheme();
})();
