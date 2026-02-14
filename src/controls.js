const moveSpeed = 0.02;
const rotateSpeed = 0.005;

/**
 * Sets up mouse control for camera movement.
 */
export function setupCameraControls(renderer, canvas) {
  let isLeftDragging = false;
  let isRightDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let disableContextMenu = false;
  let relativeMoveSpeed = 1.0;

  canvas.onmousedown = (event) => {
    disableContextMenu = false;
    if (event.button === 0) isLeftDragging = true;
    if (event.button === 2) isRightDragging = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  };

  canvas.onmouseup = (event) => {
    if (event.button === 0) isLeftDragging = false;
    if (event.button === 2) isRightDragging = false;
  };

  canvas.onmousemove = (event) => {
    const deltaX = event.clientX - lastMouseX;
    const deltaY = event.clientY - lastMouseY;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    const cam = renderer.scene.settings.cam;

    if (isLeftDragging) {
      //Camnera translation
      const moveRight = { x: cam.right.x, y: cam.right.y, z: cam.right.z };
      const moveForward = { x: cam.forward.x, y: cam.forward.y, z: cam.forward.z };

      cam.position.x += moveSpeed * relativeMoveSpeed * (deltaX * moveRight.x - deltaY * moveForward.x);
      cam.position.y += moveSpeed * relativeMoveSpeed * (deltaX * moveRight.y - deltaY * moveForward.y);
      cam.position.z += moveSpeed * relativeMoveSpeed * (deltaX * moveRight.z - deltaY * moveForward.z);
    }

    if (isRightDragging) {
      if (Math.abs(deltaX) + Math.abs(deltaY) > 0) disableContextMenu = true;
      //Camera orientation
      const yawRad = -deltaX * rotateSpeed;
      const cosYaw = Math.cos(yawRad);
      const sinYaw = Math.sin(yawRad);

      const newForwardX = cam.forward.x * cosYaw - cam.forward.z * sinYaw;
      const newForwardZ = cam.forward.x * sinYaw + cam.forward.z * cosYaw;
      cam.forward.x = newForwardX;
      cam.forward.z = newForwardZ;

      const pitchRad = deltaY * rotateSpeed;
      const cosPitch = Math.cos(pitchRad);
      const sinPitch = Math.sin(pitchRad);

      const rightCrossX = cam.right.y * cam.forward.z - cam.right.z * cam.forward.y;
      const rightCrossY = cam.right.z * cam.forward.x - cam.right.x * cam.forward.z;
      const rightCrossZ = cam.right.x * cam.forward.y - cam.right.y * cam.forward.x;

      cam.forward.x = cam.forward.x * cosPitch + rightCrossX * sinPitch;
      cam.forward.y = cam.forward.y * cosPitch + rightCrossY * sinPitch;
      cam.forward.z = cam.forward.z * cosPitch + rightCrossZ * sinPitch;

      const forwardLength = Math.sqrt(cam.forward.x * cam.forward.x + cam.forward.y * cam.forward.y + cam.forward.z * cam.forward.z);
      cam.forward.x /= forwardLength;
      cam.forward.y /= forwardLength;
      cam.forward.z /= forwardLength;

      // Recalculate right vector (cross product of world up and forward)
      const worldUp = { x: 0, y: 1, z: 0 };
      cam.right.x = worldUp.y * cam.forward.z - worldUp.z * cam.forward.y;
      cam.right.y = worldUp.z * cam.forward.x - worldUp.x * cam.forward.z;
      cam.right.z = worldUp.x * cam.forward.y - worldUp.y * cam.forward.x;

      const rightLength = Math.sqrt(cam.right.x * cam.right.x + cam.right.y * cam.right.y + cam.right.z * cam.right.z);
      cam.right.x /= rightLength;
      cam.right.y /= rightLength;
      cam.right.z /= rightLength;

      // Recalculate up vector (cross product of forward and right)
      cam.up.x = cam.forward.y * cam.right.z - cam.forward.z * cam.right.y;
      cam.up.y = cam.forward.z * cam.right.x - cam.forward.x * cam.right.z;
      cam.up.z = cam.forward.x * cam.right.y - cam.forward.y * cam.right.x;
    }

    if (isLeftDragging || isRightDragging) {
      renderer.invalidateAccumulation();
      // Query depth at center of screen to adjust movement speed
      renderer.getDepthAt(renderer.canvas.width / 2, renderer.canvas.height / 2).then((depth) => {
        if (depth) relativeMoveSpeed = Math.min(1.0, Math.max(0.00001, depth));
      });
    }
  };

  // Prevent context menu on right-click
  canvas.oncontextmenu = (event) => {
    if (disableContextMenu) {
      event.preventDefault();
    }
  };
}
