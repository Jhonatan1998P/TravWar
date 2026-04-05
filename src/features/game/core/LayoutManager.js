const TEMPLATES = {
    '4-4-4-6': { Wood: 4, Clay: 4, Iron: 4, Wheat: 6 },
    '3-5-4-6': { Wood: 3, Clay: 5, Iron: 4, Wheat: 6 },
    '5-3-4-6': { Wood: 5, Clay: 3, Iron: 4, Wheat: 6 },
    '4-5-3-6': { Wood: 4, Clay: 5, Iron: 3, Wheat: 6 },
    '3-4-5-6': { Wood: 3, Clay: 4, Iron: 5, Wheat: 6 },
    '5-4-3-6': { Wood: 5, Clay: 4, Iron: 3, Wheat: 6 },
    '3-3-3-9': { Wood: 3, Clay: 3, Iron: 3, Wheat: 9 },
    '1-1-1-15': { Wood: 1, Clay: 1, Iron: 1, Wheat: 15 }
};

const RESOURCE_LAYOUT_CONFIG = {
    outerRing: { count: 12, radiusPercent: 80 },
    innerRing: { count: 6, radiusPercent: 40 },
    totalSlots: 18
};

function getResourceName(type) {
    const names = {
        Wood: 'Leñador',
        Clay: 'Barrera',
        Iron: 'Mina Hierro',
        Wheat: 'Granja'
    };
    return names[type] || 'Recurso';
}

function generateLayout(templateKey = '4-4-4-6') {
    const template = TEMPLATES[templateKey] || TEMPLATES['4-4-4-6'];
    const resourcePool = [];

    for (const [type, count] of Object.entries(template)) {
        for (let i = 0; i < count; i++) {
            resourcePool.push(type);
        }
    }
    
    let outerRingIndex = 0;
    let innerRingIndex = 0;

    return resourcePool.map((type, index) => {
        let ring, angle;

        if (index < RESOURCE_LAYOUT_CONFIG.outerRing.count) {
            ring = 'outer';
            angle = (360 / RESOURCE_LAYOUT_CONFIG.outerRing.count) * outerRingIndex++;
        } else {
            ring = 'inner';
            angle = (360 / RESOURCE_LAYOUT_CONFIG.innerRing.count) * innerRingIndex++;
        }

        return {
            id: `${type.charAt(0).toLowerCase()}${index + 1}`,
            defaultType: type,
            name: getResourceName(type),
            angle,
            radiusPercent: RESOURCE_LAYOUT_CONFIG[`${ring}Ring`].radiusPercent,
        };
    });
}

const VILLAGE_CENTER_LAYOUT_CONFIG = {
    outerRing: { count: 12, radiusPercent: 85 },
    middleRing: { count: 8, radiusPercent: 48 },
    centerSlot: { count: 1, radiusPercent: 0 },
};

function generateVillageCenterLayout() {
    const layout = [];
    const totalSlots = 21;
    
    const specialAssignments = {
        0: 'v_main',
        7: 'v_rally_point' 
    };

    let dynamicSlotIndex = 1;

    for (let i = 0; i < totalSlots; i++) {
        let id;
        if (specialAssignments.hasOwnProperty(i)) {
            id = specialAssignments[i];
        } else {
            id = `v${dynamicSlotIndex++}`;
        }
        
        let config;
        let angleIndex;

        if (i === 0) {
            config = VILLAGE_CENTER_LAYOUT_CONFIG.centerSlot;
            angleIndex = 0;
        } else if (i > 0 && i <= 8) {
            config = VILLAGE_CENTER_LAYOUT_CONFIG.middleRing;
            angleIndex = i - 1;
        } else {
            config = VILLAGE_CENTER_LAYOUT_CONFIG.outerRing;
            angleIndex = i - 9;
        }
        
        layout.push({
            id: id,
            angle: (360 / config.count) * angleIndex,
            radiusPercent: config.radiusPercent
        });
    }
    return layout;
}

export { generateLayout, generateVillageCenterLayout, TEMPLATES };