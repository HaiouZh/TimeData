export interface GalaxyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GalaxyViewport {
  x: number;
  y: number;
  zoom: number;
}

export type ClusterLod = "expanded" | "collapsed";

export const GALAXY_LOD_EXPAND_PX = 520;
export const GALAXY_LOD_COLLAPSE_PX = 360;

export function clusterLod(boundsWorld: GalaxyRect, viewport: GalaxyViewport, current: ClusterLod): ClusterLod {
  const apparent = Math.max(boundsWorld.width, boundsWorld.height) * viewport.zoom;
  if (apparent >= GALAXY_LOD_EXPAND_PX) return "expanded";
  if (apparent <= GALAXY_LOD_COLLAPSE_PX) return "collapsed";
  return current;
}
