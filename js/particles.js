// Generador de lluvia de partículas ASCII estilo Matrix optimizado con Canvas 2D
function initParticles(containerId = 'particles') {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Si ya existe un canvas activo, evitar duplicados
    if (container.querySelector('canvas')) return;

    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const chars = ['0', '1', '{', '}', '>', '_', '$', 'X', '#', '!', '?'];
    let width = 0;
    let height = 0;
    let particles = [];
    let animationFrameId = null;

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;

        const count = width <= 768 ? 20 : 40; // Ajuste dinámico de carga según pantalla
        particles = [];
        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                char: chars[Math.floor(Math.random() * chars.length)],
                speed: Math.random() * 1.5 + 0.8,
                opacity: Math.random() * 0.35 + 0.08,
                size: Math.floor(Math.random() * 6 + 14)
            });
        }
    }

    let lastTime = 0;
    function render(time) {
        if (!lastTime) lastTime = time;
        const delta = Math.min((time - lastTime) / 1000, 0.1);
        lastTime = time;

        ctx.clearRect(0, 0, width, height);

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.y += p.speed * 60 * delta;
            if (p.y > height + 20) {
                p.y = -20;
                p.x = Math.random() * width;
                p.char = chars[Math.floor(Math.random() * chars.length)];
            }

            ctx.fillStyle = `rgba(0, 255, 65, ${p.opacity})`;
            ctx.font = `${p.size}px 'VT323', monospace`;
            ctx.fillText(p.char, p.x, p.y);
        }

        if (!document.hidden) {
            animationFrameId = requestAnimationFrame(render);
        }
    }

    window.addEventListener('resize', resize, { passive: true });
    resize();
    animationFrameId = requestAnimationFrame(render);

    // Pausar renderizado cuando la pestaña esté oculta para ahorrar CPU y batería
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            lastTime = 0;
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            animationFrameId = requestAnimationFrame(render);
        } else {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        }
    });
}

window.initParticles = initParticles;
