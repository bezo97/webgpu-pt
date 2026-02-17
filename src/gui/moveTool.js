const moveSpeed = 0.02;
const rotateSpeed = 0.005;

/**
 * Left-click drag to translate camera, right-click drag to rotate camera
 */
export class MoveTool {
  #isActive = false;

  constructor(renderer) {
    this.renderer = renderer;
    this.parentPane = null;
    this.toolButton = null;
    this.activeToolTitle = "[🎮 Move]";
    this.inactiveToolTitle = "🎮 Move";
    this.dragState = {
      isLeftDragging: false,
      isRightDragging: false,
      lastMouseX: 0,
      lastMouseY: 0,
    };
    this.relativeMoveSpeed = 1.0; // Updates based on depth
  }

  createGUI(parentPane, onButtonClick) {
    this.parentPane = parentPane;
    this.toolButton = parentPane.addButton({
      title: this.inactiveToolTitle,
    });
    this.toolButton.on("click", onButtonClick);
  }

  activate() {
    if (this.#isActive) return;
    this.#isActive = true;
    this.dragState = {
      isLeftDragging: false,
      isRightDragging: false,
      lastMouseX: 0,
      lastMouseY: 0,
    };
    this.updateButtonState();
  }

  deactivate() {
    this.#isActive = false;
    this.dragState = {
      isLeftDragging: false,
      isRightDragging: false,
      lastMouseX: 0,
      lastMouseY: 0,
    };
    this.updateButtonState();
  }

  /**
   * Update the tool button title based on active state
   */
  updateButtonState = () => {
    if (this.toolButton) {
      this.toolButton.title = this.#isActive ? this.activeToolTitle : this.inactiveToolTitle;
    }
  };

  onMouseDown = (event) => {
    if (event.button === 0) this.dragState.isLeftDragging = true;
    if (event.button === 2) this.dragState.isRightDragging = true;
    this.dragState.lastMouseX = event.clientX;
    this.dragState.lastMouseY = event.clientY;
  };

  onMouseUp = (event) => {
    if (event.button === 0) this.dragState.isLeftDragging = false;
    if (event.button === 2) this.dragState.isRightDragging = false;
  };

  onMouseMove = (event) => {
    if (!this.#isActive || (!this.dragState.isLeftDragging && !this.dragState.isRightDragging)) return;

    const deltaX = event.clientX - this.dragState.lastMouseX;
    const deltaY = event.clientY - this.dragState.lastMouseY;
    this.dragState.lastMouseX = event.clientX;
    this.dragState.lastMouseY = event.clientY;

    const cam = this.renderer.scene.settings.cam;
    const moveRight = { x: cam.right.x, y: cam.right.y, z: cam.right.z };
    const moveForward = { x: cam.forward.x, y: cam.forward.y, z: cam.forward.z };

    if (this.dragState.isLeftDragging) {
      // Camera translation
      cam.position.x += moveSpeed * this.relativeMoveSpeed * (deltaX * moveRight.x - deltaY * moveForward.x);
      cam.position.y += moveSpeed * this.relativeMoveSpeed * (deltaX * moveRight.y - deltaY * moveForward.y);
      cam.position.z += moveSpeed * this.relativeMoveSpeed * (deltaX * moveRight.z - deltaY * moveForward.z);
    }

    if (this.dragState.isRightDragging) {
      // Camera orientation
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

    if (this.dragState.isLeftDragging || this.dragState.isRightDragging) {
      this.renderer.invalidateAccumulation();
      // Query depth at center of screen to adjust movement speed
      this.renderer.getDepthAt(this.renderer.canvas.width / 2, this.renderer.canvas.height / 2).then((depth) => {
        if (depth) this.relativeMoveSpeed = Math.min(1.0, Math.max(0.00001, depth));
      });
    }
  };
}
