/** Referenced from a large surface's backdrop-filter: raises the blurred backdrop
 * to full alpha so sharp content behind the transparent window cannot leak. */
export function SolidBlurFilter({ id }: { id: string }) {
  return (
    <svg className="solid-blur-filter" aria-hidden="true" focusable="false">
      <filter id={id} x="0" y="0" width="1" height="1">
        <feComponentTransfer>
          <feFuncA type="linear" slope="8" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}
