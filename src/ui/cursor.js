/**
 * Smoothly follows the pointer and replaces the default cursor.
 */
export function initializeCustomCursor() {
  const cursor = document.getElementById('cursor');
  if (!cursor) return;
  let x = 0;
  let y = 0;
  let frameHandle = null;

  const update = () => {
    cursor.style.transform = `translate3d(${x - 10}px, ${y - 10}px, 0)`;
    frameHandle = null;
  };

  document.addEventListener('mousemove', (event) => {
    x = event.clientX;
    y = event.clientY;
    if (!frameHandle) {
      frameHandle = requestAnimationFrame(update);
    }
  });
}
