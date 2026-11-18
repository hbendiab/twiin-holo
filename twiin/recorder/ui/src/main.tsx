// Point d'entrée des composants React de Twiin. La page (JavaScript simple) les monte avec :
//   const sphere = TwiinUI.mountSphere(element, { images, autoRotateSpeed, ... });
//   sphere.update({ images: autres }); sphere.unmount();
import './index.css';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SphereImageGrid, { type ImageData, type SphereImageGridProps } from '@/components/ui/image-sphere';

export type SphereProps = Omit<SphereImageGridProps, 'containerSize' | 'sphereRadius'> & { maxSize?: number };

// La sphère prend la largeur de son emplacement (jusqu'à maxSize) : elle reste ronde sur un téléphone comme sur un grand écran.
function ResponsiveSphere({ maxSize = 460, ...props }: SphereProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize(Math.max(220, Math.min(maxSize, el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxSize]);
  return (
    <div ref={ref} className="flex w-full justify-center">
      {size > 0 && <SphereImageGrid key={size} containerSize={size} sphereRadius={size * 0.36} {...props} />}
    </div>
  );
}

function mountSphere(el: HTMLElement, props: SphereProps) {
  const root = createRoot(el);
  let current = props;
  root.render(<ResponsiveSphere {...current} />);
  return {
    update(next: Partial<SphereProps>) {
      current = { ...current, ...next };
      root.render(<ResponsiveSphere {...current} />);
    },
    unmount() {
      root.unmount();
    },
  };
}

// Compilé en IIFE nommé « TwiinUI » : les exports deviennent window.TwiinUI.mountSphere
export { mountSphere };
export type { ImageData };
