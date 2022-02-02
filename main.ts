import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';

const CIVIL = false;

const HEADERS =
    ["course content", "course learning objectives", "course objectives", "course outcomes", "books", "reference books"];
if (CIVIL) {
    HEADERS.push("prerequisites");
}

const COURSE_INFO_HEADERS = [
    "course title",
    "course code",
    "number of credits",
    "prerequisites",
    "course type",
];

type Token =
    | { kind: "text", value: string, level: number }
    | { kind: "courseHeader", value: any }
    | { kind: "infoHeader", value: string }
    | { kind: "list", value: "start" | "end" };

class Lexer {
    private tokens: Token[] = [];
    get currentToken() {
        return this.tokens[this.tokens.length - 1];
    }

    findInfoHeader(text: string): string | null {
        text = text.replace('\n', ' ').trim();
        for (let header of COURSE_INFO_HEADERS) {
            if (text.toLowerCase().startsWith(header)) {
                return header;
            }
        }
        return null;
    }

    visitCourseHead2(table: Element) {
        let cells = $$('th,td', table);
        if (cells.length != 5) {
            return;
        }
        let obj: Partial<Course> = {};
        obj["course code"] = cells[0]?.textContent?.trim();
        obj["course title"] = cells[1]?.textContent?.trim();
        obj["course type"] = cells[2]?.textContent?.trim();
        obj["number of credits"] = cells[4]?.textContent?.trim();
        if (!/[A-Z]{4}\d{2}/.test(obj["course code"])) {
            console.error(`Invalid course code: ${obj["course code"]}`);
            return;
        }
        this.tokens.push({ kind: 'courseHeader', value: obj });
    }

    visitCourseHead(table: Element) {
        if (CIVIL) {
            return this.visitCourseHead2(table);
        }
        let cells = $$('th,td', table);

        let obj: { [key: string]: string } = {};

        let curr: string | null = null;
        for (let c of cells) {
            let text = c.textContent.trim();
            let header = this.findInfoHeader(text);
            if (header != null) {
                curr = header;

            } else if (text != ':' && (text != '' || curr == "prerequisites") && curr != null) {
                obj[curr] = text;
                curr = null;
            }
        }
        if (this.currentToken && this.currentToken.kind == "text" && this.currentToken.value.toLowerCase() == obj["course title"]?.trim()?.toLowerCase()) {
            // remove the course title heading
            this.tokens.pop();
        }
        if (this.currentToken && this.currentToken.kind == "courseHeader") {
            Object.assign(this.currentToken.value, obj);
        } else {
            this.tokens.push({ kind: 'courseHeader', value: obj });
        }
    }

    visitText(e: Element) {
        let text = e.textContent.trim();
        let level = 7;
        switch (e.tagName) {
            case 'H1':
            case 'H2':
            case 'H3':
                level = 2;
                break;
            case 'H4':
                level = 3;
                break;
            case 'H5':
                level = 4;
                break;
            case 'H6':
                level = 5;
                break;
            case 'STRONG': case 'B':
                level = 6;
                break;
        }
        if (text.includes("Semester") && level != 7) {
            return;
        }

        if (text.length > 0) {
            for (let header of HEADERS) {
                if (text.toLowerCase().startsWith(header)) {
                    text = text.substring(header.length).trim();
                    this.tokens.push({ kind: 'infoHeader', value: header });
                    if (text.startsWith("s")) {
                        text = text.substring(1).trim();
                    }
                    if (text.startsWith(":")) {
                        text = text.substring(1).trim();
                    }
                    if (text == "") {
                        return;
                    }
                    level = 2;
                    if (CIVIL && header == "prerequisites") {
                        let idx = text.toLowerCase().indexOf("course");
                        if (idx != -1) {
                            let value = text.substring(0, idx).trim();
                            this.tokens.push({ kind: 'text', value, level });
                            text = text.substring(idx).trim();
                            let newElem = document.createElement("h2");
                            newElem.innerHTML = text;
                            this.visit(newElem);
                            return;
                        }
                    }
                    break;
                }
            }
            this.tokens.push({ kind: 'text', value: text, level });
        }
    }

    visit(e: Element) {
        switch (e.tagName) {
            case 'TABLE':
                this.visitCourseHead(e);
                break;

            case 'BLOCKQUOTE':
                for (let child of e.childNodes) {
                    this.visit(child as Element);
                }
                break;
            case 'UL': case 'OL':
                this.tokens.push({ kind: 'list', value: 'start' });
                for (let child of $$('li', e)) {
                    this.visit(child as Element);
                }
                this.tokens.push({ kind: 'list', value: 'end' });
                break;

            default:
                this.visitText(e);
                break;
        }
    }

    finish(): Token[] {
        return this.tokens;
    }
}

type Course = {
    [key: string]: string;
}

class Parser {
    courses: Course[] = [];
    private curr_course: Course | null = null;
    private curr_header: string | null = null;
    private curr_text: string = "";
    private in_list = 0;

    endHeader() {
        if (this.curr_header != null && this.curr_text != "") {
            this.curr_course[this.curr_header] = this.curr_text.trim();
            this.curr_header = null;
            this.curr_text = "";
            this.in_list = 0;
        }
    }

    endCourse() {
        if (this.curr_course != null) {
            this.endHeader();
            this.courses.push(this.curr_course);
            this.curr_course = null;
        }
    }

    eat(token: Token) {
        switch (token.kind) {
            case "courseHeader":
                if (CIVIL && token.value["prerequisites"] == undefined) {
                    token.value["prerequisites"] = "";
                }
                if (token.value["course code"] == undefined) {
                    return;
                }
                for (const h of COURSE_INFO_HEADERS) {
                    if (token.value[h] == undefined) {
                        console.error(`Missing ${h}`);
                        console.error(token.value);
                    }
                }
                token.value["branch"] = BRANCH;
                this.endCourse();
                this.curr_course = token.value;
                break;
            case "infoHeader":
                this.endHeader();
                this.curr_header = token.value;
                break;
            case "text":
                const is_unit = /^unit[ -ivx0-9]+/i.test(token.value);
                if (is_unit && this.curr_header != "course content") {
                    this.endHeader();
                    this.curr_header = "course content";
                }
                if (this.in_list > 0) {
                    this.curr_text += "- ";
                } else if (is_unit) {
                    this.curr_text += "\n\n## ";
                }
                this.curr_text += token.value + "\n";
                if (is_unit) {
                    this.curr_text += "\n";
                }
                break;
            case "list":
                if (token.value == "start") {
                    this.in_list++;
                } else {
                    this.in_list--;
                }
                break;
        }
    }

    finish(): Course[] {
        this.endCourse();
        return this.courses;
    }
}

function main() {
    let tables = $$("table");
    let curr = ansectors(tables[offset]).pop();
    let lexer = new Lexer();
    while (curr != null) {
        lexer.visit(curr);
        curr = curr.nextElementSibling;
    }
    let tokens = lexer.finish();
    let parser = new Parser();
    for (let token of tokens) {
        parser.eat(token);
    }
    let courses = parser.finish();
    console.log(JSON.stringify(courses, null, 2));
}

function $$(selector: string, parent: Element | undefined = undefined): Element[] {
    let elements;
    if (parent) {
        elements = parent.querySelectorAll(selector);
    } else {
        elements = document.querySelectorAll(selector);
    }
    return Array.from(elements);
}

// NOTE: also includes self
function ansectors(element: Element): Element[] {
    let ancestors = [];
    let parent = element;
    while (parent && parent.tagName !== 'BODY') {
        ancestors.push(parent);
        parent = parent.parentElement;
    }
    return ancestors;
}

// node only stuff
let file = process.argv[2];
let BRANCH = file.split(".")[0];
let fileText = readFileSync(file, 'utf8');

let offset = parseInt(process.argv[3]);

let { window } = new JSDOM(fileText, { runScripts: "outside-only" });
let document = window.document;
main();
