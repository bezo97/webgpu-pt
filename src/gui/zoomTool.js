/**
 * Left-click to zoom to a point, right-click to zoom out
 */
export class ZoomTool {
  #isActive = false;

  constructor(renderer) {
    this.renderer = renderer;
    this.parentPane = null;
    this.toolButton = null;
    this.activeToolTitle = "[🔍 Zoom]";
    this.inactiveToolTitle = "🔍 Zoom";
  }

  createGUI(parentPane, onButtonClick) {
    this.parentPane = parentPane;
    this.toolButton = parentPane.addButton({
      title: this.inactiveToolTitle,
    });
    this.toolButton.on("click", onButtonClick);
  }

  onMouseDown = async (event) => {
    if (!this.#isActive) return;

    const rect = this.renderer.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (event.button === 0) {
      // Left-click: zoom to target
      const depth = await this.renderer.getDepthAt(x, y);
      if (depth !== undefined && depth > 0) {
        const targetPoint = this.renderer.screenToWorld(x, y, depth);
        this.zoomToTarget(targetPoint);
      } else {
        console.log("No depth data available at clicked position");
      }
    } else if (event.button === 2) {
      // Right-click: zoom out
      this.zoomOut();
    }
  };

  /**
   * Zoom to target point (look at + move halfway + set focus)
   * @param {{x: number, y: number, z: number}} targetPoint - The target world position
   */
  zoomToTarget(targetPoint) {
    const cam = this.renderer.scene.settings.cam;

    // Store current camera position
    const currentPos = {
      x: cam.position.x,
      y: cam.position.y,
      z: cam.position.z,
    };

    // Calculate midpoint between current position and target
    const midpoint = {
      x: (currentPos.x + targetPoint.x) / 2,
      y: (currentPos.y + targetPoint.y) / 2,
      z: (currentPos.z + targetPoint.z) / 2,
    };

    // Calculate new forward vector (from midpoint to target)
    let forwardX = targetPoint.x - midpoint.x;
    let forwardY = targetPoint.y - midpoint.y;
    let forwardZ = targetPoint.z - midpoint.z;

    // Normalize forward vector
    const forwardLen = Math.sqrt(forwardX * forwardX + forwardY * forwardY + forwardZ * forwardZ);
    const newFocusDistance = forwardLen;
    forwardX /= forwardLen;
    forwardY /= forwardLen;
    forwardZ /= forwardLen;

    // Update camera position to midpoint
    cam.position.x = midpoint.x;
    cam.position.y = midpoint.y;
    cam.position.z = midpoint.z;

    // Update forward vector
    cam.forward.x = forwardX;
    cam.forward.y = forwardY;
    cam.forward.z = forwardZ;

    // Recalculate right vector (cross product of world up and forward)
    const worldUp = { x: 0, y: 1, z: 0 };
    cam.right.x = worldUp.y * cam.forward.z - worldUp.z * cam.forward.y;
    cam.right.y = worldUp.z * cam.forward.x - worldUp.x * cam.forward.z;
    cam.right.z = worldUp.x * cam.forward.y - worldUp.y * cam.forward.x;

    // Recalculate up vector (cross product of forward and right)
    cam.up.x = cam.forward.y * cam.right.z - cam.forward.z * cam.right.y;
    cam.up.y = cam.forward.z * cam.right.x - cam.forward.x * cam.right.z;
    cam.up.z = cam.forward.x * cam.right.y - cam.forward.y * cam.right.x;

    cam.focus_distance = newFocusDistance;

    this.renderer.invalidateAccumulation();
  }

  /**
   * Zoom out (move camera backwards + set focus)
   */
  zoomOut() {
    const cam = this.renderer.scene.settings.cam;
    const moveBackDistance = cam.focus_distance / 2; // Move back a bit, depending on focus distance

    // Move camera backwards (opposite to forward direction)
    cam.position.x -= moveBackDistance * cam.forward.x;
    cam.position.y -= moveBackDistance * cam.forward.y;
    cam.position.z -= moveBackDistance * cam.forward.z;

    cam.focus_distance += moveBackDistance;

    this.renderer.invalidateAccumulation();
  }

  activate() {
    if (this.#isActive) return;
    this.#isActive = true;
    // Update button state
    this.updateButtonState();
  }

  deactivate() {
    this.#isActive = false;
    // Update button state
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
}
