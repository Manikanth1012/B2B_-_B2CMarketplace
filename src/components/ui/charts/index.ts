/* Charts (spec 18). See each component for when to use it:
   ColumnChart / BarChart (vertical) for change over time or magnitude across
   a few things; BarChart (horizontal) for a ranking or a mix; LineChart /
   AreaChart for a trend; DonutChart for share of a whole; Sparkline inline. */
export { SERIES, CHART_SLOTS, seriesColour, categoryColour } from './palette'
export { ColumnChart } from './ColumnChart'
export type { Column } from './ColumnChart'
export { BarChart } from './BarChart'
export type { Bar } from './BarChart'
export { LineChart, AreaChart } from './LineChart'
export type { LineSeries } from './LineChart'
export { DonutChart } from './DonutChart'
export type { Slice } from './DonutChart'
export { Sparkline } from './Sparkline'
export { money0, compactMoney, compactNumber, niceTicks } from './common'
