/**
 * Lightweight entity-component system tailored for this game.
 * Components are stored as plain objects keyed by entity id, and
 * queries are cached sets of entity ids matching component combinations.
 */
export class SimpleECS {
  constructor() {
    this.entities = new Set();
    this.nextEntityId = 1;
    this.componentRegistry = new Map();
    this.queryCache = new Map();
  }

  createWorld() {
    return this;
  }

  addEntity() {
    const id = this.nextEntityId++;
    this.entities.add(id);
    return id;
  }

  removeEntity(world, id) {
    if (!this.entities.has(id)) return;
    this.entities.delete(id);
    for (const cache of this.queryCache.values()) {
      cache.delete(id);
    }
    for (const component of this.componentRegistry.values()) {
      delete component.data[id];
    }
  }

  defineComponent() {
    const componentData = {};
    const componentName = `c${this.componentRegistry.size}`;
    const component = {
      name: componentName,
      data: componentData,
      add: (id, initialValues = {}) => {
        componentData[id] = { ...initialValues };
        this.#updateCaches(id, componentName);
      },
      has: (id) => id in componentData,
      get: (id) => componentData[id],
      remove: (id) => {
        if (id in componentData) {
          delete componentData[id];
          this.#updateCaches(id, componentName);
        }
      },
    };
    this.componentRegistry.set(componentName, component);
    return component;
  }

  addComponent(world, component, id, initialValues = {}) {
    component.add(id, initialValues);
  }

  removeComponent(world, component, id) {
    component.remove(id);
  }

  hasComponent(world, component, id) {
    return component.has(id);
  }

  defineQuery(components) {
    const queryKey = components.map((c) => c.name).sort().join(',');
    if (!this.queryCache.has(queryKey)) {
      const cache = new Set();
      for (const id of this.entities) {
        if (components.every((component) => component.has(id))) {
          cache.add(id);
        }
      }
      this.queryCache.set(queryKey, cache);
    }
    return () => this.queryCache.get(queryKey);
  }

  entityExists(world, id) {
    return this.entities.has(id);
  }

  #updateCaches(id, componentName) {
    for (const [queryKey, cache] of this.queryCache.entries()) {
      const componentsInQuery = queryKey.split(',');
      if (!componentsInQuery.includes(componentName)) continue;
      const matches = componentsInQuery.every((name) =>
        this.componentRegistry.get(name)?.has(id),
      );
      if (matches) {
        cache.add(id);
      } else {
        cache.delete(id);
      }
    }
  }
}
