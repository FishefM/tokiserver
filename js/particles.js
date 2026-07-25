// Generador de lluvia de partículas ASCII estilo Matrix
function initParticles(containerId = 'particles') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const chars = ['0', '1', '{', '}', '>', '_', '$', 'X', '#', '!', '?'];

    function createParticle() {
        const p = document.createElement('div');
        p.classList.add('particle');
        p.innerText = chars[Math.floor(Math.random() * chars.length)];
        p.style.left = Math.random() * 100 + 'vw';
        const duration = Math.random() * 5 + 3;
        p.style.animationDuration = duration + 's';
        p.style.opacity = Math.random() * 0.4 + 0.1;

        container.appendChild(p);

        setTimeout(() => {
            p.remove();
        }, duration * 1000);
    }

    setInterval(createParticle, 150);
}
