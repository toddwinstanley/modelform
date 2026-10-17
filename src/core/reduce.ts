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
  | 'diff';

export function reduce(values: Array<number | null | undefined>, calc: string = 'lastNotNull'): number | null {
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
    default:
      return nums.length ? nums[nums.length - 1] : null;
  }
}
