// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/**
 * Switches between the Listen and Generate panels.
 *
 * Follows the ARIA tabs pattern: arrow keys move between tabs, Home and End jump
 * to the ends, and only the selected tab stays in the tab order.
 *
 * The initial state is expressed in the markup (aria-selected, hidden), so this
 * module only reacts to input.
 */

document.querySelectorAll('[role=tablist]').forEach((tablist) => {
  const tabs = Array.from(tablist.querySelectorAll('[role=tab]'));
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));

  function select(index, moveFocus = true) {
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[i].hidden = !active;
    });

    if (moveFocus) tabs[index].focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));

    tab.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];

      if (step) {
        event.preventDefault();
        select((index + step + tabs.length) % tabs.length);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        select(event.key === 'Home' ? 0 : tabs.length - 1);
      }
    });
  });
});
