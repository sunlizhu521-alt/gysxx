const ADMIN_SESSION_KEY = "supply-chain-admin-unlocked";

if (sessionStorage.getItem(ADMIN_SESSION_KEY) !== "1") {
  window.location.replace("./admin.html");
}
