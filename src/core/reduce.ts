/** Grafana "calcs" reducers used by stat, gauge, bar gauge and pie panels. */

export type Reducer =
  | 'last'
  | 'lastNotNull'
  | 'first'
  | 'firstNotNull'
  | 'mean'
  | 'sum'
  | 'min'
  | 'max'
  | 'count'
  | 'delta'
  | 'range'
  | 'diff'
  | 'median'
  | 'variance'
  | 'stdDev'
  | 'distinctCount'
  | 'changeCount';

/** Grafana's names for the reducers, as its legends and table footers label them. */
export const REDUCER_LABELS: Record<Reducer, string> = {
  last: 'Last',
  lastNotNull: 'Last *',
  first: 'First',
  firstNotNull: 'First *',
  mean: 'Mean',
  sum: 'Total',
  min: 'Min',
  max: 'Max',
  count: 'Count',
  delta: 'Delta',
  range: 'Range',
  diff: 'Difference',
  median: 'Median',
  variance: 'Variance',
  stdDev: 'StdDev',
  distinctCount: 'Distinct Count',
  changeCount: 'Change Count',
};

export const isReducer = (calc: string): calc is Reducer => calc in REDUCER_LABELS;

export function reduce(values: (number | null | undefined)[], calc: string = 'lastNotNull'): number | null {
  const nums = values.filter((v): v is number => v != null && !Number.isNaN(v));
  switch (calc as Reducer) {
    case 'last':
      return values.length ? values[values.length - 1] ?? null : null;
    case 'lastNotNull':
      return nums.length ? nums[nums.length - 1] : null;
    case 'first':
      return values.length ? values[0] ?? null : null;
    case 'firstNotNull':
      return nums.length ? nums[0] : null;
    case 'mean':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'min':
      return nums.length ? Math.min(...nums) : null;
    case 'max':
      return nums.length ? Math.max(...nums) : null;
    case 'count':
      return values.length;
    case 'range':
      return nums.length ? Math.max(...nums) - Math.min(...nums) : null;
    case 'diff':
      return nums.length ? nums[nums.length - 1] - nums[0] : null;
    case 'delta': {
      // Sum of increases, treating drops as counter resets.
      let total = 0;
      for (let i = 1; i < nums.length; i++) total += nums[i] >= nums[i - 1] ? nums[i] - nums[i - 1] : nums[i];
      return total;
    }
    case 'median': {
      if (!nums.length) return null;
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    case 'variance':
    case 'stdDev': {
      if (!nums.length) return null;
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
      return calc === 'stdDev' ? Math.sqrt(variance) : variance;
    }
    case 'distinctCount':
      return new Set(nums).size;
    case 'changeCount': {
      let changes = 0;
      for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i - 1]) changes++;
      return changes;
    }
    default:
      return nums.length ? nums[nums.length - 1] : null;
  }
}
