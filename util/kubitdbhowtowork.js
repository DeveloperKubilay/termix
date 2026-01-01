const fs = require('fs');

function load(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch (e) {
        if (String(e).split("Error: ENOENT: no such file or directory").length > 1) {
            this.mkdirfile = ""
            file.split("/").map((x, c) => {
                if (c === file.split("/").length - 1) return;
                this.mkdirfile += x + "/"
                fs.mkdirSync(this.mkdirfile, { recursive: true })
            }); write(file, {});
            return JSON.parse(fs.readFileSync(file, 'utf-8'))
        } else { return {} }
    }
};
function write(file, data) { try { fs.writeFileSync(file, JSON.stringify(data, undefined, 2)) } catch { } };

class kubitdb {
    constructor(file) {
        this.file = file || 'kubitdb.json'
        if (this.file === 'kubitdb.json') { try { load(this.file); } catch { write(this.file, {}); } } else {
            if (this.file.split('.')[this.file.split('.').length - 1] !== 'json') this.file = this.file + '.json'
            if (!this.file.includes('./')) { this.file = './' + this.file }
            try { load(this.file); } catch { write(this.file, {}); }
        }
    }

    set(data, value) {
        if (!data || value == undefined) return;
        let fileData = load(this.file)
        fileData[data] = value;
        write(this.file, fileData);
        return;
    }

    ayarla(data, value) { return this.set(data, value); }

    add(data, value) {
        if (!data || value == undefined) return;
        let fileData = load(this.file)

        if (typeof value == "number") {
            if (fileData[data] === undefined) return this.set(data, value);
            if (typeof fileData[data] !== "number" || isNaN(fileData[data])) return this.set(data, value);
            fileData[data] = fileData[data] + value;
        } else {
            if (fileData[data] === undefined || typeof fileData[data] !== "number" || isNaN(fileData[data])) return;
            fileData[data] = fileData[data] + value;
        }
        write(this.file, fileData);
        return;
    }

    ekle(data, value) { return this.add(data, value); }

    subtract(data, value) {
        if (!data || value == undefined) return;
        let fileData = load(this.file)
        if (fileData[data] === undefined) return;
        if (isNaN(fileData[data] - value)) return;
        fileData[data] = fileData[data] - value
        write(this.file, fileData);
        return;
    }

    substr(data, value) { return this.subtract(data, value); }
    cıkar(data, value) { return this.subtract(data, value); }

    push(array, value) {
        if (!array || value == undefined) return;
        let fileData = load(this.file)
        if (fileData[array] && Array.isArray(fileData[array])) {
            fileData[array].push(value)
            write(this.file, fileData)
        } else if (!fileData[array]) { this.set(array, [value]) }
        return;
    }

    it(array, value) { return this.push(array, value); }

    delete(array, index) {
        if (!array) return;
        let fileData = load(this.file)
        if (!fileData[array]) return;

        if (index === undefined) {
            fileData[array] = undefined;
            write(this.file, fileData);
        } else {
            if (isNaN(fileData[array] - index)) return;
            fileData[array] = fileData[array] - index;
            write(this.file, fileData);
        }
        return;
    }

    del(array, index) { return this.delete(array, index); }
    sil(array, index) { return this.delete(array, index); }

    has(data) {
        if (!data) return;
        let fileData = load(this.file)
        return !!fileData[data];
    }

    varmı(data) { return this.has(data); }

    clear() {
        write(this.file, {});
        return;
    }

    clearAll() { return this.clear(); }
    temizle() { return this.clear(); }
    deleteAll() { return this.clear(); }

    fetchAll() { return load(this.file); }

    getAll() { return this.fetchAll(); }
    all() { return this.fetchAll(); }
    hepsi() { return this.fetchAll(); }
    hepsinial() { return this.fetchAll(); }

    fetch(data) {
        if (!data) return;
        let fileData = load(this.file)
        return fileData[data]
    }

    get(data) { return this.fetch(data); }
    bak(data) { return this.fetch(data); }
    al(data) { return this.fetch(data); }

    math(data, operator, value) {
        if (!data || !operator || value == undefined || typeof value !== "number") return;
        let fileData = load(this.file)
        if (typeof fileData[data] !== "number") return;

        if (operator === "-") {
            return fileData[data] - value;
        } else if (operator === "+") {
            return fileData[data] + value;
        } else if (operator === "*") {
            return fileData[data] * value;
        } else if (operator === "/") {
            return fileData[data] / value;
        } else {
            return;
        }
    }

    hesapla(data, operator, value) { return this.math(data, operator, value); }

} 

module.exports = kubitdb;