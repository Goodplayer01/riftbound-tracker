import { useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { t, type Lang } from './i18n'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Classes for the input (e.g. "search", "field stores-query"). */
  className?: string
  /** Extra classes on the wrapper (e.g. "grow"). */
  wrapClassName?: string
  style?: CSSProperties
  lang: Lang
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  'aria-label'?: string
}

/** Text search with a clear X on the right when there is typed text. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className = 'search',
  wrapClassName = '',
  style,
  lang,
  onKeyDown,
  'aria-label': ariaLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrap = ['search-wrap', wrapClassName].filter(Boolean).join(' ')

  return (
    <div className={wrap} style={style}>
      <input
        ref={inputRef}
        className={className}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value ? (
        <button
          type="button"
          className="search-clear"
          aria-label={t(lang, 'search.clear')}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}
