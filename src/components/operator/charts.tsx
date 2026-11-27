/* The operator console's charts now live in ui/charts (spec 18), shared by
   every console and built on the --chart-1..6 tokens. This module keeps the
   old import path working for the screens that have not moved yet. */
export { SERIES, seriesColour, categoryColour, ColumnChart, BarChart, LineChart, AreaChart, DonutChart, Sparkline } from '../ui/charts'
export type { Column, Slice, Bar, LineSeries } from '../ui/charts'
