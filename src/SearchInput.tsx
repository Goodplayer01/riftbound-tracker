import { useRef, type InputHTMLAttributes } from 'react'
import { t, type Lang } from './i18n'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Classes for the input (e.g. "search", "field stores-query"). */
  className?: string
  /** Extra classes on the wrapper (e.g. "grow"). */
  wrapClassName?: string
  lang: Lang
}

/** Text search with a clear X on the right when there is typed text. */
export function SearchInput({
  value,
  onChange,
  className = 'search',
  wrapClassName,
  lang,
  ...rest
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={`search-wrap ${wrapClassName ?? ''}`}>
      <input
        {...rest}
        ref={inputRef}
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
