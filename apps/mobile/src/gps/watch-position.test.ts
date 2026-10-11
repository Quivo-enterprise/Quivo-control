import { beforeEach, describe, expect, it, vi } from 'vitest';

const watchPosition = vi.hoisted(() => vi.fn());
vi.mock('react-native-background-geolocation', () => ({ default: { watchPosition } }));

import { watchPositionAsync } from './watch-position';

describe('watchPositionAsync', () => {
  beforeEach(() => watchPosition.mockReset());

  it('runtime real: devuelve la Promise de la suscripción y no pasa errorCallback', async () => {
    const remove = vi.fn();
    watchPosition.mockReturnValue(Promise.resolve({ id: 7, remove }));
    const onLocation = vi.fn();
    const sub = await watchPositionAsync({ interval: 1000 } as never, onLocation);
    expect(sub.id).toBe(7);
    expect(watchPosition).toHaveBeenCalledWith({ interval: 1000 }, onLocation);
    sub.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('normaliza una Subscription síncrona a Promise', async () => {
    const remove = vi.fn();
    watchPosition.mockReturnValue({ remove });
    const sub = await watchPositionAsync({} as never, vi.fn());
    expect(sub.remove).toBe(remove);
  });
});
