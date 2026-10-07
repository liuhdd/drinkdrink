// DOM 类型在查找时校验，避免断言掩盖页面结构错误。 Validate DOM types during lookup instead of asserting page structure.
export function element<T extends Element>(root: ParentNode, selector: string, constructor: { new(): T }): T {
  const found = root.querySelector(selector);
  if (!(found instanceof constructor)) throw new TypeError(`页面元素 ${selector} 缺失或类型不正确`);
  return found;
}
export function target(event: Event): Element {
  if (!(event.target instanceof Element)) throw new TypeError('事件目标不是页面元素');
  return event.target;
}
export function closest<T extends Element>(source: Element, selector: string, constructor: { new(): T }): T {
  const found = source.closest(selector);
  if (!(found instanceof constructor)) throw new TypeError(`页面父元素 ${selector} 缺失或类型不正确`);
  return found;
}
