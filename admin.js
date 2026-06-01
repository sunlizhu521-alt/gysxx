const ADMIN_KEY = "3.1415926";
const ADMIN_SESSION_KEY = "supply-chain-admin-unlocked";

const adminEls = {
  gatePanel: document.querySelector("#adminGatePanel"),
  links: document.querySelector("#adminLinks"),
  keyInput: document.querySelector("#adminKey"),
  unlockButton: document.querySelector("#adminUnlockButton"),
  state: document.querySelector("#adminState"),
};

function unlockAdmin() {
  const value = adminEls.keyInput.value.trim();
  if (value !== ADMIN_KEY) {
    adminEls.state.textContent = "\u79d8\u94a5\u9519\u8bef";
    adminEls.keyInput.select();
    return;
  }
  sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  showAdminLinks();
}

function showAdminLinks() {
  adminEls.gatePanel.hidden = true;
  adminEls.links.hidden = false;
}

adminEls.unlockButton.addEventListener("click", unlockAdmin);
adminEls.keyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") unlockAdmin();
});

if (sessionStorage.getItem(ADMIN_SESSION_KEY) === "1") {
  showAdminLinks();
}
