import { useEffect, useRef } from 'react'
import styles from './Background.module.css'

export type HaloPlacement = 'hero' | 'top' | 'center'

/**
 * Fond de l'application : noir profond, champ d'étoiles fixe, léger grain
 * et halo rouge-orangé (derrière le logo sur l'accueil).
 */
export function Background({ halo }: { halo: HaloPlacement }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    // Graine fixe : les étoiles ne « sautent » pas quand on redimensionne.
    const draw = (): void => {
      const ratio = window.devicePixelRatio || 1
      const { innerWidth: w, innerHeight: h } = window
      canvas.width = Math.floor(w * ratio)
      canvas.height = Math.floor(h * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, w, h)
      let seed = 1337
      const random = (): number => {
        seed = (seed * 16807) % 2147483647
        return seed / 2147483647
      }
      const count = Math.round((w * h) / 4200)
      for (let i = 0; i < count; i++) {
        const x = random() * w
        const y = random() * h
        const r = random() < 0.92 ? 0.35 + random() * 0.55 : 0.9 + random() * 0.6
        const alpha = 0.12 + random() * 0.55
        const warm = random() < 0.18
        ctx.fillStyle = warm ? `rgba(255, 196, 140, ${alpha})` : `rgba(235, 235, 245, ${alpha})`
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    draw()
    let frame = 0
    const onResize = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(draw)
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div className={styles.root} aria-hidden="true">
      <canvas ref={canvasRef} className={styles.stars} />
      <div className={`${styles.halo} ${styles[halo]}`} />
      <div className={styles.grain} />
      <div className={styles.vignette} />
    </div>
  )
}
