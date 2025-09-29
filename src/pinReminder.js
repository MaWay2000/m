function closeWindow() {
  window.close();
}

document.addEventListener("DOMContentLoaded", () => {
  const gotItButton = document.getElementById("got-it");

  if (gotItButton) {
    gotItButton.addEventListener("click", () => {
      closeWindow();
    });
  }
});
