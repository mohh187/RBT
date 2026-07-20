import Icon from '../Icon.jsx'
import { kindIcon, kindLabel, sectionLabel } from '../../lib/genLog.js'

// Filter bar for the generation log. Chips are built from what this venue has
// ACTUALLY generated (with counts) rather than a fixed list, so a venue that has
// never made a 3D model is not offered an empty "3D models" filter.
// Hoisted (not defined inside the render) so React keeps the same element type
// between renders instead of remounting every chip on each keystroke.
function Chip({ active, onClick, icon, children, count }) {
  return (
    <button type="button" className={`gh-chip${active ? ' on' : ''}`} onClick={onClick} aria-pressed={active}>
      {icon && <Icon name={icon} size={13} />}
      <span>{children}</span>
      {count != null && <span className="gh-chip-count">{count}</span>}
    </button>
  )
}

export default function GenFilters({ filters, onChange, kindCounts = [], sectionCounts = [], statusCounts = {}, ar = true }) {
  const set = (patch) => onChange({ ...filters, ...patch })
  const dirty = Boolean(
    filters.search || filters.from || filters.to || (filters.kind && filters.kind !== 'all') ||
    (filters.section && filters.section !== 'all') || (filters.status && filters.status !== 'all'),
  )

  return (
    <div className="card card-pad gh-filters">
      <div className="gh-searchrow">
        <div className="gh-search">
          <span className="gh-search-ic"><Icon name="search" size={16} /></span>
          <input
            className="input"
            type="search"
            value={filters.search || ''}
            onChange={(e) => set({ search: e.target.value })}
            placeholder={ar ? 'ابحث في البرومبت والنتيجة والنموذج' : 'Search prompts, results, model'}
            aria-label={ar ? 'بحث' : 'Search'}
          />
        </div>
        {dirty && (
          <button
            className="btn btn-ghost btn-sm gh-reset"
            onClick={() => onChange({ kind: 'all', section: 'all', search: '', from: '', to: '', status: 'all' })}
          >
            <Icon name="undo" size={14} /> {ar ? 'مسح الفلاتر' : 'Clear filters'}
          </button>
        )}
      </div>

      {kindCounts.length > 0 && (
        <div className="gh-filter-block">
          <span className="gh-filter-label">{ar ? 'النوع' : 'Kind'}</span>
          <div className="gh-chips">
            <Chip active={!filters.kind || filters.kind === 'all'} onClick={() => set({ kind: 'all' })} icon="layers">
              {ar ? 'الكل' : 'All'}
            </Chip>
            {kindCounts.map(({ id, count }) => (
              <Chip key={id} active={filters.kind === id} onClick={() => set({ kind: id })} icon={kindIcon(id)} count={count}>
                {kindLabel(id, ar)}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {sectionCounts.length > 1 && (
        <div className="gh-filter-block">
          <span className="gh-filter-label">{ar ? 'المكان' : 'Section'}</span>
          <div className="gh-chips">
            <Chip active={!filters.section || filters.section === 'all'} onClick={() => set({ section: 'all' })}>
              {ar ? 'كل الأماكن' : 'All sections'}
            </Chip>
            {sectionCounts.map(({ id, count }) => (
              <Chip key={id} active={filters.section === id} onClick={() => set({ section: id })} count={count}>
                {sectionLabel(id, ar)}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="gh-filter-block">
        <span className="gh-filter-label">{ar ? 'الحالة والتاريخ' : 'Status & date'}</span>
        <div className="gh-chips">
          <Chip active={!filters.status || filters.status === 'all'} onClick={() => set({ status: 'all' })}>
            {ar ? 'الكل' : 'All'}
          </Chip>
          <Chip active={filters.status === 'ok'} onClick={() => set({ status: 'ok' })} icon="check" count={statusCounts.ok}>
            {ar ? 'ناجحة' : 'Succeeded'}
          </Chip>
          <Chip active={filters.status === 'failed'} onClick={() => set({ status: 'failed' })} icon="warning" count={statusCounts.failed}>
            {ar ? 'فاشلة' : 'Failed'}
          </Chip>
        </div>
        <div className="gh-dates">
          <div className="gh-date-field">
            <label htmlFor="gh-from">{ar ? 'من تاريخ' : 'From'}</label>
            <input id="gh-from" className="input input-sm" type="date" value={filters.from || ''} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div className="gh-date-field">
            <label htmlFor="gh-to">{ar ? 'إلى تاريخ' : 'To'}</label>
            <input id="gh-to" className="input input-sm" type="date" value={filters.to || ''} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          </div>
        </div>
      </div>
    </div>
  )
}
