import { useEffect, useRef, useState } from 'react'

/*
 * Tête du joueur, découpée dans sa skin : visage (8×8) + couche du chapeau/cheveux par-dessus.
 * Sans skin (pas encore téléchargée, hors ligne), on affiche le visage de Steve.
 */
const STEVE_PALETTE: Record<string, string> = {
  H: '#2f200f',
  S: '#b98a6c',
  W: '#f2f2f2',
  E: '#4b3b8f',
  N: '#7a4b36',
  M: '#5a2f20'
}
const STEVE_FACE = ['HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH', 'SSSSSSSS', 'SWESSEWS', 'SSSNNSSS', 'SSMSSMSS', 'SSMMMMSS']

interface SkinHeadProps {
  /** Texture de la skin (PNG en data URL), ou null. */
  skin: string | null
  size?: number
  title?: string
}

export function SkinHead({ skin, size = 36, title = 'Tête du skin' }: SkinHeadProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failedSkin, setFailedSkin] = useState<string | null>(null)
  const radius = Math.max(3, size / 9)

  useEffect(() => {
    if (!skin) return
    const image = new Image()
    image.onload = () => {
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, 8, 8)
      ctx.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8)
      ctx.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8)
    }
    image.onerror = () => setFailedSkin(skin)
    image.src = skin
  }, [skin])

  if (skin && failedSkin !== skin) {
    return (
      <canvas
        ref={canvasRef}
        width={8}
        height={8}
        role="img"
        aria-label={title}
        style={{ width: size, height: size, imageRendering: 'pixelated', borderRadius: radius, flex: 'none' }}
      />
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      role="img"
      aria-label={title}
      style={{ borderRadius: radius, flex: 'none' }}
    >
      {STEVE_FACE.flatMap((row, y) =>
        [...row].map((code, x) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={STEVE_PALETTE[code] ?? '#000'} />)
      )}
    </svg>
  )
}
