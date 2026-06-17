// ── Toast helper ──────────────────────────────────────────
function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.background = isError
        ? 'linear-gradient(135deg,#ef4444,#b91c1c)'
        : 'linear-gradient(135deg,#4f8ef7,#7c3aed)';
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.classList.remove('visible'); }, 3500);
}

