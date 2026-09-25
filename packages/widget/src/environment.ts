export interface Environment {
  viewport_w: number;
  viewport_h: number;
  device_pixel_ratio: number;
  user_agent: string;
  language: string;
  build_id: string | null;
}

export function captureEnvironment(buildId: string | null): Environment {
  return {
    viewport_w: Math.round(window.innerWidth),
    viewport_h: Math.round(window.innerHeight),
    device_pixel_ratio: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    user_agent: navigator.userAgent.slice(0, 512),
    language: (navigator.language || document.documentElement.lang || '').slice(0, 35),
    build_id: buildId,
  };
}
