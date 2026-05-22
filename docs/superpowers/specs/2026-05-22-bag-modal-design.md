# My Bag — Modal Design

**Date:** 2026-05-22

## Goal

Move the "My Bag" club setup from a panel buried at the bottom of the Players tab into a modal opened by a dedicated button. Nothing changes about the bag data model or save logic.

## Current state

- `#bagSetupPanel` is a plain `<div class="panel">` at the bottom of `#view-players`, rendered by `renderBagSetup()` whenever the Players tab is opened.
- It renders only when `activeId` is set (a player is selected).
- Content: club list with ↑/↓/✕ reorder and delete, master-list dropdown, custom club text input.
- Save: `saveBag(bag)` → `sbUpdate('players', id, {bag})`.

## Changes

### Remove panel from Players tab

Delete `<div class="panel" id="bagSetupPanel" style="margin-top:1rem"></div>` from `#view-players`.

`renderBagSetup()` is updated to render into the modal body instead.

### Add modal

New `bagModal` using the existing `modal-bg` + `modal modal-sm` pattern:

```html
<div class="modal-bg" id="bagModal" style="display:none">
  <div class="modal modal-sm">
    <div class="mh">
      <span class="mt" id="bagModalTitle">🎒 My Bag</span>
      <button class="btn btn-ghost btn-sm" onclick="closeModal('bagModal')">✕</button>
    </div>
    <div id="bagSetupPanel"></div>
  </div>
</div>
```

The `id="bagSetupPanel"` moves inside the modal — `renderBagSetup()` needs no other changes.

### Add button

In the Players tab header row (the `<div class="ph">` of the Club Roster panel), add a **🎒 My Bag** button immediately before the existing `+ Add Player` button:

```html
<button class="btn btn-ghost btn-sm" id="myBagBtn" style="display:none"
  onclick="openBagModal()">🎒 My Bag</button>
```

`display:none` by default; shown only when `activeId` is set (same pattern as `addPlayerBtn`).

### New function

```js
function openBagModal() {
  const p = players.find(x => x.id === activeId);
  if (!p) return;
  document.getElementById('bagModalTitle').textContent = `🎒 ${p.name}'s Bag`;
  renderBagSetup();
  document.getElementById('bagModal').style.display = 'flex';
}
```

### Show/hide button

Wherever `addPlayerBtn` visibility is toggled (on player select / admin check), apply the same logic to `myBagBtn`: show when `activeId` is set, hide when not.

## Out of scope

- Yardage / distance per club
- Club photos
- Bag sharing between players
