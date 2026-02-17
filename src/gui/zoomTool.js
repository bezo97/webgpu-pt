const ANIMATION_DURATION = 0.1; // seconds

// some common easing functions to choose from
const easing = {
  linear: (t) => t,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

/**
 * Left-click to zoom to a point, right-click to zoom out.
 * Includes smooth camera animation.
 */
export class ZoomTool {
  #isActive = false;
  #animationHandle = null; // { requestId: number | null; cancel: () => void } | null
  #easingFunc = easing.easeInOutCubic;

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

  activate() {
    if (this.#isActive) return;
    this.#isActive = true;
    this.updateButtonState();
  }

  deactivate() {
    // Cancel any ongoing animation
    if (this.#animationHandle) {
      this.#animationHandle.cancel();
      this.#animationHandle = null;
    }
    this.#isActive = false;
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

  onMouseDown = async (event) => {
    if (!this.#isActive || this.#animationHandle) return;

    const rect = this.renderer.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (event.button === 0) {
      // Left-click: zoom to target
      const depth = await this.renderer.getDepthAt(x, y);
      if (depth !== undefined && depth > 0) {
        const targetPoint = this.renderer.screenToWorld(x, y, depth);
        this.animateCamera(targetPoint);
      } else {
        console.log("No depth data available at clicked position");
      }
    } else if (event.button === 2) {
      // Right-click: zoom out
      this.animateCamera(undefined); // no target -> zoom out
    }
  };

  /**
   * Animate camera to either target point or zoom out.
   * Call with targetPoint to zoom in, or without argument to zoom out.
   * @param {{x: number, y: number, z: number}} [targetPoint] - Optional target world position
   */
  async animateCamera(targetPoint) {
    // Cancel previous animation
    if (this.#animationHandle) {
      this.#animationHandle.cancel();
    }

    const startTime = performance.now();
    const currentCam = this.renderer.scene.settings.cam;
    const startState = {
      position: { ...currentCam.position },
      forward: { ...currentCam.forward },
      right: { ...currentCam.right },
      up: { ...currentCam.up },
      focus_distance: currentCam.focus_distance,
    };
    const endState = targetPoint ? this.#calculateZoomToTargetState(currentCam, targetPoint) : this.#calculateZoomOutState(currentCam);

    const animate = (currentTime) => {
      const elapsed = (currentTime - startTime) / 1000; // Convert to seconds
      const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
      const easedProgress = this.#easingFunc(progress);

      if (progress < 1) {
        // Interpolate between start and end states
        const currentState = this.#interpolateCamera(startState, endState, easedProgress);
        currentCam.position = { ...currentState.position };
        currentCam.forward = { ...currentState.forward };
        currentCam.right = { ...currentState.right };
        currentCam.up = { ...currentState.up };
        currentCam.focus_distance = currentState.focus_distance;

        this.#animationHandle.requestId = requestAnimationFrame(animate);
      } else {
        // Animation complete
        currentCam.position = { ...endState.position };
        currentCam.forward = { ...endState.forward };
        currentCam.right = { ...endState.right };
        currentCam.up = { ...endState.up };
        currentCam.focus_distance = endState.focus_distance;
        this.#animationHandle = null;
      }

      this.renderer.invalidateAccumulation();
    };

    // Start animation
    this.#animationHandle = {
      cancel: () => {
        if (this.#animationHandle && this.#animationHandle.requestId) {
          cancelAnimationFrame(this.#animationHandle.requestId);
        }
      },
      requestId: null,
    };

    // Start the animation loop
    animate(startTime);
  }

  /**
   * Calculate target camera state for zoom to target,
   * including new position, orientation, and focus distance.
   */
  #calculateZoomToTargetState(currentCam, targetPoint) {
    const currentPos = currentCam.position;

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

    // Calculate right vector (cross product of world up and forward)
    const worldUp = { x: 0, y: 1, z: 0 };
    const right = {
      x: worldUp.y * forwardZ - worldUp.z * forwardY,
      y: worldUp.z * forwardX - worldUp.x * forwardZ,
      z: worldUp.x * forwardY - worldUp.y * forwardX,
    };

    // Calculate up vector (cross product of forward and right)
    const up = {
      x: forwardY * right.z - forwardZ * right.y,
      y: forwardZ * right.x - forwardX * right.z,
      z: forwardX * right.y - forwardY * right.x,
    };

    return {
      position: midpoint,
      forward: { x: forwardX, y: forwardY, z: forwardZ },
      right: right,
      up: up,
      focus_distance: newFocusDistance,
    };
  }

  /**
   * Calculate target camera state for zoom out,
   * including new position and increased focus distance.
   */
  #calculateZoomOutState(currentCam) {
    const moveBackDistance = currentCam.focus_distance / 2;

    return {
      position: {
        x: currentCam.position.x - moveBackDistance * currentCam.forward.x,
        y: currentCam.position.y - moveBackDistance * currentCam.forward.y,
        z: currentCam.position.z - moveBackDistance * currentCam.forward.z,
      },
      forward: { ...currentCam.forward },
      right: { ...currentCam.right },
      up: { ...currentCam.up },
      focus_distance: currentCam.focus_distance + moveBackDistance,
    };
  }

  /**
   * Linearly interpolate between two camera states
   */
  #interpolateCamera(start, end, t) {
    return {
      position: {
        x: start.position.x + (end.position.x - start.position.x) * t,
        y: start.position.y + (end.position.y - start.position.y) * t,
        z: start.position.z + (end.position.z - start.position.z) * t,
      },
      forward: {
        x: start.forward.x + (end.forward.x - start.forward.x) * t,
        y: start.forward.y + (end.forward.y - start.forward.y) * t,
        z: start.forward.z + (end.forward.z - start.forward.z) * t,
      },
      right: {
        x: start.right.x + (end.right.x - start.right.x) * t,
        y: start.right.y + (end.right.y - start.right.y) * t,
        z: start.right.z + (end.right.z - start.right.z) * t,
      },
      up: {
        x: start.up.x + (end.up.x - start.up.x) * t,
        y: start.up.y + (end.up.y - start.up.y) * t,
        z: start.up.z + (end.up.z - start.up.z) * t,
      },
      focus_distance: start.focus_distance + (end.focus_distance - start.focus_distance) * t,
    };
  }
}
