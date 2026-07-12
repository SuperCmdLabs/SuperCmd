/**
 * Pure layout helpers for virtualized Grid rendering.
 */

export const GRID_DEFAULT_COLUMNS = 5;
export const GRID_MIN_COLUMNS = 1;
export const GRID_MAX_COLUMNS = 8;
export const GRID_DEFAULT_ITEM_HEIGHT = 160;
export const GRID_ITEM_LABEL_HEIGHT = 34;
export const GRID_SECTION_HEADER_HEIGHT = 30;
export const GRID_ROW_GAP = 8;
export const GRID_GROUP_GAP = 8;
export const GRID_DEFAULT_OVERSCAN = GRID_DEFAULT_ITEM_HEIGHT * 2;

export type GridFitValue = 'contain' | 'fill';
export type GridInsetValue = 'zero' | 'sm' | 'md' | 'lg';

export interface GridSectionLayoutOptions {
  id?: string;
  title?: string;
  subtitle?: string;
  columns?: number;
  aspectRatio?: string;
  fit?: string;
  inset?: string;
}

export interface VirtualGridItemEntry {
  item: {
    id: string;
    props: any;
    section?: GridSectionLayoutOptions;
  };
  globalIdx: number;
}

export interface VirtualGridGroup {
  key?: string;
  title?: string;
  subtitle?: string;
  section?: GridSectionLayoutOptions;
  items: VirtualGridItemEntry[];
}

export interface ResolvedGridSectionLayout {
  columns: number;
  aspectRatio?: string;
  fit: GridFitValue;
  inset: GridInsetValue;
  itemHeight: number;
}

export type VirtualGridRow =
  | {
      kind: 'section';
      key: string;
      sectionKey: string;
      title?: string;
      subtitle?: string;
      top: number;
      height: number;
    }
  | {
      kind: 'items';
      key: string;
      sectionKey: string;
      top: number;
      height: number;
      itemHeight: number;
      items: VirtualGridItemEntry[];
      layout: ResolvedGridSectionLayout;
    };

export interface VirtualGridLayout {
  rows: VirtualGridRow[];
  totalHeight: number;
  itemCount: number;
  itemPositions: Array<{ top: number; height: number } | undefined>;
  itemColumns: Array<number | undefined>;
}

export interface BuildVirtualGridLayoutOptions {
  defaultColumns?: number;
  itemSize?: string;
  defaultAspectRatio?: string;
  defaultFit?: string;
  defaultInset?: string;
  containerWidth?: number;
}

export interface VisibleRowsOptions {
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}

export interface ItemScrollOptions {
  currentScrollTop: number;
  viewportHeight: number;
  scrollPadding?: number;
}

export function normalizeGridColumns(columns?: number, fallback = GRID_DEFAULT_COLUMNS, itemSize?: string): number {
  const sizeColumns = itemSize === 'small' ? 8 : itemSize === 'large' ? 3 : undefined;
  const explicitColumns = typeof columns === 'number' && Number.isFinite(columns) ? columns : undefined;
  const candidate = explicitColumns ?? sizeColumns ?? fallback;
  const normalized = Number.isFinite(candidate) ? Math.floor(candidate) : GRID_DEFAULT_COLUMNS;
  return Math.max(GRID_MIN_COLUMNS, Math.min(GRID_MAX_COLUMNS, normalized));
}

export function normalizeGridFit(value?: string): GridFitValue {
  return value === 'fill' ? 'fill' : 'contain';
}

export function normalizeGridInset(value?: string): GridInsetValue {
  if (value === 'zero' || value === 'none') return 'zero';
  if (value === 'sm' || value === 'small') return 'sm';
  if (value === 'md' || value === 'medium') return 'md';
  if (value === 'lg' || value === 'large') return 'lg';
  return 'sm';
}

export function normalizeGridAspectRatio(value?: string): string | undefined {
  if (!value) return undefined;
  const ratio = parseGridAspectRatio(value);
  return ratio > 0 ? value : undefined;
}

export function parseGridAspectRatio(value?: string): number {
  if (!value) return 0;
  if (value.includes('/')) {
    const [width, height] = value.split('/').map((part) => Number(part));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height;
    }
    return 0;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function getGridItemHeight(columns: number, containerWidth?: number, aspectRatio?: string): number {
  const ratio = parseGridAspectRatio(aspectRatio);
  if (!ratio || !containerWidth || containerWidth <= 0) return GRID_DEFAULT_ITEM_HEIGHT;

  const safeColumns = normalizeGridColumns(columns);
  const totalGap = GRID_ROW_GAP * Math.max(0, safeColumns - 1);
  const itemWidth = Math.max(1, (containerWidth - totalGap) / safeColumns);
  return Math.max(96, Math.ceil(itemWidth / ratio + GRID_ITEM_LABEL_HEIGHT));
}

export function resolveGridSectionLayout(
  section: GridSectionLayoutOptions | undefined,
  options: BuildVirtualGridLayoutOptions,
): ResolvedGridSectionLayout {
  const columns = normalizeGridColumns(section?.columns, normalizeGridColumns(options.defaultColumns, GRID_DEFAULT_COLUMNS, options.itemSize));
  const aspectRatio = normalizeGridAspectRatio(section?.aspectRatio ?? options.defaultAspectRatio);
  const fit = normalizeGridFit(section?.fit ?? options.defaultFit);
  const inset = normalizeGridInset(section?.inset ?? options.defaultInset);
  const itemHeight = getGridItemHeight(columns, options.containerWidth, aspectRatio);

  return { columns, aspectRatio, fit, inset, itemHeight };
}

export function buildVirtualGridLayout(
  groups: VirtualGridGroup[],
  options: BuildVirtualGridLayoutOptions = {},
): VirtualGridLayout {
  const rows: VirtualGridRow[] = [];
  const itemPositions: Array<{ top: number; height: number } | undefined> = [];
  const itemColumns: Array<number | undefined> = [];
  let top = 0;
  let itemCount = 0;

  groups.forEach((group, groupIndex) => {
    const section = group.section;
    const sectionKey = group.key || section?.id || group.title || `group-${groupIndex}`;
    const title = group.title ?? section?.title;
    const subtitle = group.subtitle ?? section?.subtitle;

    if (title) {
      rows.push({
        kind: 'section',
        key: `${sectionKey}:header`,
        sectionKey,
        title,
        subtitle,
        top,
        height: GRID_SECTION_HEADER_HEIGHT,
      });
      top += GRID_SECTION_HEADER_HEIGHT;
    }

    const layout = resolveGridSectionLayout(section, options);
    for (let start = 0; start < group.items.length; start += layout.columns) {
      const rowItems = group.items.slice(start, start + layout.columns);
      rows.push({
        kind: 'items',
        key: `${sectionKey}:items:${start}`,
        sectionKey,
        top,
        height: layout.itemHeight,
        itemHeight: layout.itemHeight,
        items: rowItems,
        layout,
      });

      for (const entry of rowItems) {
        itemPositions[entry.globalIdx] = { top, height: layout.itemHeight };
        itemColumns[entry.globalIdx] = layout.columns;
      }

      itemCount += rowItems.length;
      top += layout.itemHeight;
      if (start + layout.columns < group.items.length) top += GRID_ROW_GAP;
    }

    if (title || group.items.length > 0) top += GRID_GROUP_GAP;
  });

  return {
    rows,
    totalHeight: top,
    itemCount,
    itemPositions,
    itemColumns,
  };
}

export function getVisibleVirtualRows(rows: VirtualGridRow[], options: VisibleRowsOptions): VirtualGridRow[] {
  const overscan = options.overscan ?? GRID_DEFAULT_OVERSCAN;
  const viewportHeight = Math.max(1, options.viewportHeight || GRID_DEFAULT_ITEM_HEIGHT);
  const start = Math.max(0, options.scrollTop - overscan);
  const end = options.scrollTop + viewportHeight + overscan;

  const firstVisibleIndex = findFirstRowWithBottomAtOrAfter(rows, start);
  const endIndex = findFirstRowWithTopAfter(rows, end);

  return rows.slice(firstVisibleIndex, endIndex);
}

function findFirstRowWithBottomAtOrAfter(rows: VirtualGridRow[], start: number): number {
  let low = 0;
  let high = rows.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const row = rows[mid];
    if (row.top + row.height < start) low = mid + 1;
    else high = mid;
  }

  return low;
}

function findFirstRowWithTopAfter(rows: VirtualGridRow[], end: number): number {
  let low = 0;
  let high = rows.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (rows[mid].top <= end) low = mid + 1;
    else high = mid;
  }

  return low;
}

export function getScrollTopForItemIndex(
  layout: Pick<VirtualGridLayout, 'itemPositions'>,
  itemIndex: number,
  options: ItemScrollOptions,
): number {
  const position = layout.itemPositions[itemIndex];
  if (!position) return options.currentScrollTop;

  const scrollPadding = options.scrollPadding ?? GRID_ROW_GAP;
  const viewportHeight = Math.max(1, options.viewportHeight || GRID_DEFAULT_ITEM_HEIGHT);
  const currentTop = Math.max(0, options.currentScrollTop);
  const currentBottom = currentTop + viewportHeight;
  const itemTop = position.top;
  const itemBottom = position.top + position.height;

  if (itemTop < currentTop + scrollPadding) {
    return Math.max(0, itemTop - scrollPadding);
  }

  if (itemBottom > currentBottom - scrollPadding) {
    return Math.max(0, itemBottom - viewportHeight + scrollPadding);
  }

  return currentTop;
}

export function getColumnsForItemIndex(
  layout: Pick<VirtualGridLayout, 'itemColumns'>,
  itemIndex: number,
  fallbackColumns = GRID_DEFAULT_COLUMNS,
): number {
  return normalizeGridColumns(layout.itemColumns[itemIndex], fallbackColumns);
}

export function countVirtualizedRowItems(rows: VirtualGridRow[]): number {
  return rows.reduce((total, row) => total + (row.kind === 'items' ? row.items.length : 0), 0);
}
