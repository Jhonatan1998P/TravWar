export function reconcileList(container, items, keyFn, nodeMap, createNode, updateNode) {
    if (!container || !Array.isArray(items) || typeof keyFn !== 'function') {
        return;
    }

    const nextKeys = new Set();

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const key = String(keyFn(item, index));
        nextKeys.add(key);

        let node = nodeMap.get(key);
        if (!node) {
            node = createNode(item, key, index);
            if (!node) {
                continue;
            }
            nodeMap.set(key, node);
        }

        updateNode(node, item, key, index);

        const expectedNodeAtIndex = container.children[index];
        if (node !== expectedNodeAtIndex) {
            container.insertBefore(node, expectedNodeAtIndex || null);
        }
    }

    for (const [key, node] of nodeMap.entries()) {
        if (!nextKeys.has(key)) {
            if (node && node.parentNode === container) {
                container.removeChild(node);
            }
            nodeMap.delete(key);
        }
    }
}
