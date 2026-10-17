import type { MotdSegment } from '@shared/motd'

/** MOTD du serveur avec ses couleurs Minecraft (segments déjà découpés par le process principal). */
export function Motd({ segments, className }: { segments: MotdSegment[]; className?: string }): React.JSX.Element {
  return (
    <p className={className}>
      {segments.map((segment, index) => (
        <span
          key={index}
          style={{
            color: segment.color,
            fontWeight: segment.bold ? 700 : undefined,
            fontStyle: segment.italic ? 'italic' : undefined,
            textDecoration:
              [segment.underline && 'underline', segment.strikethrough && 'line-through'].filter(Boolean).join(' ') ||
              undefined
          }}
        >
          {segment.text}
        </span>
      ))}
    </p>
  )
}
