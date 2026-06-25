export interface XY {
  x: number;
  y: number;
}

export function goalCanvasFromPin(pin: XY): XY {
  return { x: pin.x, y: pin.y };
}

export function goalPinFromCanvas(position: XY): XY {
  return { x: position.x, y: position.y };
}

export function memberCanvasFromPin(pin: XY, anchorCanvas: XY): XY {
  return { x: anchorCanvas.x + pin.x, y: anchorCanvas.y + pin.y };
}

export function memberPinFromCanvas(position: XY, anchorCanvas: XY): XY {
  return { x: position.x - anchorCanvas.x, y: position.y - anchorCanvas.y };
}
