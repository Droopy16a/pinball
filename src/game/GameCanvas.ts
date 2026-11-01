import { Application, Graphics } from 'pixi.js';

export class GameCanvas {
  private app = new Application();
  private observer: ResizeObserver | undefined;
  private disposed = false;
  private initialized = false;
  private frame = new Graphics();

  async mount(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: '#111c29',
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    this.initialized = true;
    if (this.disposed) {
      this.app.destroy(true, { children: true });
      return;
    }
    host.append(this.app.canvas);
    this.app.canvas.setAttribute(
      'aria-label',
      'Neutral game rendering surface',
    );
    this.app.stage.addChild(this.frame);
    const resize = () => {
      this.app.renderer.resolution = window.devicePixelRatio || 1;
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      this.app.renderer.resize(width, height);
      this.frame
        .clear()
        .roundRect(
          20,
          20,
          Math.max(1, width - 40),
          Math.max(1, height - 40),
          12,
        )
        .stroke({ color: 0x30475c, width: 1 });
      this.frame
        .moveTo(width / 2 - 12, height / 2)
        .lineTo(width / 2 + 12, height / 2)
        .moveTo(width / 2, height / 2 - 12)
        .lineTo(width / 2, height / 2 + 12)
        .stroke({ color: 0x63839c, width: 1 });
      this.app.render();
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(host);
    this.resize = resize;
    window.addEventListener('resize', resize);
    resize();
    // No animations are running in the placeholder scene.
    this.app.stop();
  }

  private resize = () => {};

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observer?.disconnect();
    window.removeEventListener('resize', this.resize);
    if (this.initialized) this.app.destroy(true, { children: true });
  }
}
